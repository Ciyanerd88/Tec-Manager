const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const checkAdmin = (req, res, next) => {
    if (req.user?.rol_nivel >= 3) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Técnico o superior' });
};

// GET /api/contratos
router.get('/', async (req, res) => {
    try {
        const { search, tipo } = req.query;
        const params = [];
        let conditions = '';

        if (search) {
            params.push(`%${search}%`);
            // Un solo parámetro reutilizado con OR — índice correcto
            conditions += ` AND (nombre ILIKE $${params.length} OR codigo_contrato ILIKE $${params.length} OR proveedor_nombre ILIKE $${params.length})`;
        }

        if (tipo && tipo !== 'todos') {
            params.push(tipo);
            conditions += ` AND tipo_contrato = $${params.length}`;
        }

        const query = `SELECT * FROM app.contratos WHERE 1=1${conditions} ORDER BY created_at DESC`;
        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error al obtener contratos:', e);
        res.status(500).json({ success: false, message: 'Error al obtener contratos' });
    }
});

// GET /api/contratos/:id
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM app.contratos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Contrato no encontrado' });
        
        const contrato = result.rows[0];
        
        // Obtener activos asociados
        const assetsResult = await db.query(`
            SELECT a.* 
            FROM app.assets a
            JOIN app.contrato_assets ca ON a.id = ca.asset_id
            WHERE ca.contrato_id = $1
        `, [contrato.id]);
        
        contrato.assets = assetsResult.rows;
        
        res.json({ success: true, data: contrato });
    } catch (e) {
        console.error('Error al obtener contrato:', e);
        res.status(500).json({ success: false, message: 'Error al obtener contrato' });
    }
});

// POST /api/contratos  — solo Admin+
router.post('/', checkAdmin, async (req, res) => {
    try {
        const {
            codigo_contrato, nombre, tipo_contrato, fecha_desde, fecha_hasta,
            estado, coste, descripcion, contrato_principal, contrato_renovado,
            proveedor_nombre, proveedor_correo, proveedor_contacto, proveedor_telefono,
            detalles_soporte, asset_ids
        } = req.body;

        if (!codigo_contrato || !nombre) {
            return res.status(400).json({ success: false, message: 'Código y Nombre son requeridos' });
        }

        const result = await db.query(`
            INSERT INTO app.contratos (
                codigo_contrato, nombre, tipo_contrato, fecha_desde, fecha_hasta,
                estado, coste, descripcion, contrato_principal, contrato_renovado,
                creado_por, proveedor_nombre, proveedor_correo, proveedor_contacto,
                proveedor_telefono, detalles_soporte
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
        `, [
            codigo_contrato, nombre, tipo_contrato, fecha_desde || null, fecha_hasta || null,
            estado || 'Active', coste || 0.00, descripcion || null,
            contrato_principal || null, contrato_renovado || 'No',
            req.user.username,
            proveedor_nombre || null, proveedor_correo || null,
            proveedor_contacto || null, proveedor_telefono || null,
            detalles_soporte || null
        ]);

        const newContrato = result.rows[0];

        // Asociar activos si se proporcionaron
        if (asset_ids && Array.isArray(asset_ids) && asset_ids.length > 0) {
            for (const assetId of asset_ids) {
                await db.query('INSERT INTO app.contrato_assets (contrato_id, asset_id) VALUES ($1, $2)', [newContrato.id, assetId]);
            }
        }

        res.status(201).json({ success: true, data: newContrato });
    } catch (e) {
        console.error('Error al crear contrato:', e);
        if (e.code === '23505') {
            return res.status(400).json({ success: false, message: 'El código de contrato ya existe' });
        }
        res.status(500).json({ success: false, message: 'Error al crear contrato' });
    }
});

// PUT /api/contratos/:id  — solo Admin+
router.put('/:id', checkAdmin, async (req, res) => {
    try {
        const {
            codigo_contrato, nombre, tipo_contrato, fecha_desde, fecha_hasta,
            estado, coste, descripcion, contrato_principal, contrato_renovado,
            proveedor_nombre, proveedor_correo, proveedor_contacto, proveedor_telefono,
            detalles_soporte, asset_ids
        } = req.body;

        const result = await db.query(`
            UPDATE app.contratos SET
                codigo_contrato    = COALESCE($1,  codigo_contrato),
                nombre             = COALESCE($2,  nombre),
                tipo_contrato      = COALESCE($3,  tipo_contrato),
                fecha_desde        = $4,
                fecha_hasta        = $5,
                estado             = COALESCE($6,  estado),
                coste              = COALESCE($7,  coste),
                descripcion        = COALESCE($8,  descripcion),
                contrato_principal = $9,
                contrato_renovado  = COALESCE($10, contrato_renovado),
                proveedor_nombre   = COALESCE($11, proveedor_nombre),
                proveedor_correo   = COALESCE($12, proveedor_correo),
                proveedor_contacto = COALESCE($13, proveedor_contacto),
                proveedor_telefono = COALESCE($14, proveedor_telefono),
                detalles_soporte   = COALESCE($15, detalles_soporte),
                updated_at         = NOW()
            WHERE id = $16
            RETURNING *
        `, [
            codigo_contrato, nombre, tipo_contrato,
            fecha_desde || null, fecha_hasta || null,
            estado, coste, descripcion,
            contrato_principal || null, contrato_renovado,
            proveedor_nombre, proveedor_correo, proveedor_contacto,
            proveedor_telefono, detalles_soporte,
            req.params.id
        ]);

        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Contrato no encontrado' });
        
        const updatedContrato = result.rows[0];

        // Sincronizar activos si se proporcionaron
        if (asset_ids && Array.isArray(asset_ids)) {
            // Eliminar asociaciones previas
            await db.query('DELETE FROM app.contrato_assets WHERE contrato_id = $1', [req.params.id]);
            
            // Insertar nuevas asociaciones
            for (const assetId of asset_ids) {
                await db.query('INSERT INTO app.contrato_assets (contrato_id, asset_id) VALUES ($1, $2)', [req.params.id, assetId]);
            }
        }

        res.json({ success: true, data: updatedContrato });
    } catch (e) {
        console.error('Error al actualizar contrato:', e);
        res.status(500).json({ success: false, message: 'Error al actualizar contrato' });
    }
});

// DELETE /api/contratos/:id  — solo Admin+
router.delete('/:id', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('DELETE FROM app.contratos WHERE id=$1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Contrato no encontrado' });
        res.json({ success: true, message: 'Contrato eliminado' });
    } catch (e) {
        console.error('Error al eliminar contrato:', e);
        res.status(500).json({ success: false, message: 'Error al eliminar contrato' });
    }
});

module.exports = router;
