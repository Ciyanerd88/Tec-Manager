const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const uploadExcel = require('../middleware/upload_excel');
const xlsx = require('xlsx');
const fs = require('fs');

router.use(authMiddleware);


const checkAdmin = (req, res, next) => {
    if (req.user?.rol_nivel >= 3) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Técnico o superior' });
};

const safeUnlink = (filePath) => {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        console.error('Error eliminando archivo temporal:', e.message);
    }
};

// GET /api/assets
router.get('/', requirePermission('activos.ver'), async (req, res) => {
    try {
        const { search, tipo } = req.query;
        let query = 'SELECT * FROM app.assets WHERE empresa_id = $1';
        const params = [req.user.empresa_id];

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (nombre ILIKE $${params.length} OR etiqueta_servicio ILIKE $${params.length} OR direccion_ip ILIKE $${params.length} OR usuario_responsable ILIKE $${params.length})`;
        }
        if (tipo) {
            params.push(tipo);
            query += ` AND tipo_producto = $${params.length}`;
        }

        query += ' ORDER BY created_at DESC';
        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error al obtener activos:', e);
        res.status(500).json({ success: false, message: 'Error al obtener activos' });
    }
});

// POST /api/assets — solo Admin+
router.post('/', checkAdmin, async (req, res) => {
    try {
        const {
            nombre, tipo_producto, modelo, sistema_operativo,
            direccion_ip, etiqueta_servicio, estado,
            usuario_responsable, departamento, notas,
            fecha_compra, garantia_expira, numero_activo
        } = req.body;

        if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' });

        const result = await db.query(`
            INSERT INTO app.assets (
                nombre, tipo_producto, modelo, sistema_operativo,
                direccion_ip, etiqueta_servicio, estado,
                usuario_responsable, departamento, notas,
                fecha_compra, garantia_expira, numero_activo, empresa_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
        `, [
            nombre, tipo_producto, modelo, sistema_operativo,
            direccion_ip, etiqueta_servicio, estado || 'In Store',
            usuario_responsable, departamento, notas,
            fecha_compra || null, garantia_expira || null, numero_activo,
            req.user.empresa_id
        ]);

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (e) {
        console.error('Error al crear activo:', e);
        res.status(500).json({ success: false, message: 'Error al crear activo' });
    }
});

// PUT /api/assets/:id — solo Admin+
router.put('/:id', checkAdmin, async (req, res) => {
    try {
        const {
            nombre, tipo_producto, modelo, sistema_operativo,
            direccion_ip, etiqueta_servicio, estado,
            usuario_responsable, departamento, notas,
            fecha_compra, garantia_expira, numero_activo
        } = req.body;

        const result = await db.query(`
            UPDATE app.assets SET
                nombre=COALESCE($1, nombre), tipo_producto=COALESCE($2, tipo_producto),
                modelo=COALESCE($3, modelo), sistema_operativo=COALESCE($4, sistema_operativo),
                direccion_ip=COALESCE($5, direccion_ip), etiqueta_servicio=COALESCE($6, etiqueta_servicio),
                estado=COALESCE($7, estado), usuario_responsable=COALESCE($8, usuario_responsable),
                departamento=COALESCE($9, departamento), notas=COALESCE($10, notas),
                fecha_compra=$11, garantia_expira=$12,
                numero_activo=COALESCE($13, numero_activo), updated_at=NOW()
            WHERE id=$14 AND empresa_id=$15 RETURNING *
        `, [
            nombre, tipo_producto, modelo, sistema_operativo,
            direccion_ip, etiqueta_servicio, estado,
            usuario_responsable, departamento, notas,
            fecha_compra || null, garantia_expira || null,
            numero_activo, req.params.id,
            req.user.empresa_id
        ]);

        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Activo no encontrado' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        console.error('Error al actualizar activo:', e);
        res.status(500).json({ success: false, message: 'Error al actualizar activo' });
    }
});

// DELETE /api/assets/:id — solo Admin+
router.delete('/:id', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('DELETE FROM app.assets WHERE id=$1 AND empresa_id=$2 RETURNING *', [req.params.id, req.user.empresa_id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Activo no encontrado' });
        res.json({ success: true, message: 'Activo eliminado' });
    } catch (e) {
        console.error('Error al eliminar activo:', e);
        res.status(500).json({ success: false, message: 'Error al eliminar activo' });
    }
});

// POST /api/assets/import — solo Admin+
router.post('/import', checkAdmin, uploadExcel.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No se subió ningún archivo' });

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        let importedCount = 0;
        const errors = [];

        for (const row of data) {
            try {
                const nombre = row.Nombre || row.name || row.NOMBRE;
                if (!nombre) continue;

                await db.query(`
                    INSERT INTO app.assets (
                        nombre, tipo_producto, modelo, sistema_operativo,
                        direccion_ip, etiqueta_servicio, estado,
                        usuario_responsable, departamento, notas, numero_activo
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                `, [
                    nombre,
                    row['Tipo de producto'] || row.tipo || row.type || 'Desktop',
                    row.Modelo || row.model || null,
                    row['Sistema operativo'] || row.os || null,
                    row['Dirección IP'] || row.ip || null,
                    row['Etiqueta del servicio'] || row.serial || row.service_tag || null,
                    row.Estado || row.status || 'In Store',
                    row.Usuario || row.user || null,
                    row.Departamento || row.department || null,
                    row.Notas || row.notes || null,
                    row['Número de activo'] || row.numero_activo || row.asset_number || null
                ]);
                importedCount++;
            } catch (err) {
                errors.push(`Error en fila ${importedCount + 1}: ${err.message}`);
            }
        }

        safeUnlink(req.file.path);

        res.json({
            success: true,
            message: `Se importaron ${importedCount} activos correctamente`,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (e) {
        console.error('Error en importación:', e);
        if (req.file) safeUnlink(req.file.path);
        res.status(500).json({ success: false, message: 'Error al procesar el archivo Excel' });
    }
});

module.exports = router;
