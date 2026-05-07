const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

router.use(authMiddleware);

// GET /api/servers
router.get('/', requirePermission('servidores','ver'), async (req, res) => {
    try {
        const { estado } = req.query;
        let query = `
            SELECT s.*,
                   CONCAT(p.primer_nombre,' ',p.apellido) AS responsable_nombre,
                   u.username AS responsable_username
            FROM app.servers s
            LEFT JOIN app.users u ON u.id=s.responsable_id
            LEFT JOIN app.persons p ON p.id=u.persona_id
            WHERE 1=1
        `;
        const params = [];
        if (estado) { params.push(estado); query += ` AND s.estado=$${params.length}`; }
        query += ' ORDER BY s.created_at DESC';

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo servidores:', e);
        res.status(500).json({ success: false, message: 'Error al obtener servidores' });
    }
});

// GET /api/servers/:id
router.get('/:id', requirePermission('servidores','ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT s.*, CONCAT(p.primer_nombre,' ',p.apellido) AS responsable_nombre
            FROM app.servers s
            LEFT JOIN app.users u ON u.id=s.responsable_id
            LEFT JOIN app.persons p ON p.id=u.persona_id
            WHERE s.id=$1
        `, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success:false, message:'Servidor no encontrado' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener servidor' });
    }
});

// POST /api/servers
router.post('/', requirePermission('servidores','crear'), async (req, res) => {
    try {
        const { nombre, ip_address, descripcion, tipo, sistema_operativo, estado, ubicacion, responsable_id, notas } = req.body;
        if (!nombre) return res.status(400).json({ success:false, message:'El nombre es requerido' });

        const result = await db.query(`
            INSERT INTO app.servers (nombre, ip_address, descripcion, tipo, sistema_operativo, estado, ubicacion, responsable_id, notas)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
        `, [nombre, ip_address||null, descripcion||null, tipo||'servidor', sistema_operativo||null, estado||'activo', ubicacion||null, responsable_id||null, notas||null]);

        res.status(201).json({ success: true, message: 'Servidor creado exitosamente', data: result.rows[0] });
    } catch (e) {
        console.error('Error creando servidor:', e);
        res.status(500).json({ success: false, message: 'Error al crear servidor' });
    }
});

// PUT /api/servers/:id
router.put('/:id', requirePermission('servidores','editar'), async (req, res) => {
    try {
        const { nombre, ip_address, descripcion, tipo, sistema_operativo, estado, ubicacion, responsable_id, notas } = req.body;
        const result = await db.query(`
            UPDATE app.servers SET
                nombre=COALESCE($1,nombre), ip_address=COALESCE($2,ip_address),
                descripcion=COALESCE($3,descripcion), tipo=COALESCE($4,tipo),
                sistema_operativo=COALESCE($5,sistema_operativo), estado=COALESCE($6,estado),
                ubicacion=COALESCE($7,ubicacion), responsable_id=COALESCE($8,responsable_id),
                notas=COALESCE($9,notas), updated_at=NOW()
            WHERE id=$10 RETURNING *
        `, [nombre, ip_address, descripcion, tipo, sistema_operativo, estado, ubicacion, responsable_id, notas, req.params.id]);

        if (!result.rows.length) return res.status(404).json({ success:false, message:'Servidor no encontrado' });
        res.json({ success: true, message: 'Servidor actualizado', data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar servidor' });
    }
});

// DELETE /api/servers/:id
router.delete('/:id', requirePermission('servidores','eliminar'), async (req, res) => {
    try {
        const r = await db.query('DELETE FROM app.servers WHERE id=$1 RETURNING *', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Servidor no encontrado' });
        res.json({ success: true, message: 'Servidor eliminado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar servidor' });
    }
});

module.exports = router;
