const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// GET /api/services/stats
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                COUNT(*)::integer AS total,
                COUNT(*) FILTER (WHERE estado='activo')::integer AS activos,
                COUNT(*) FILTER (WHERE estado='inactivo')::integer AS inactivos,
                COUNT(*) FILTER (WHERE estado='mantenimiento')::integer AS mantenimiento
            FROM app.services
        `);
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        console.error('Error stats servicios:', e);
        res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
    }
});

// GET /api/services
router.get('/', authMiddleware, requirePermission('servicios','ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT s.*,
                   u1.username AS created_by_username,
                   u2.username AS updated_by_username
            FROM app.services s
            LEFT JOIN app.users u1 ON u1.id=s.usuario_creador_id
            LEFT JOIN app.users u2 ON u2.id=s.usuario_actualizador_id
            ORDER BY s.created_at DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo servicios:', e);
        res.status(500).json({ success: false, message: 'Error al obtener servicios' });
    }
});

// GET /api/services/:id
router.get('/:id', authMiddleware, requirePermission('servicios','ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT s.*, u1.username AS created_by_username
            FROM app.services s
            LEFT JOIN app.users u1 ON u1.id=s.usuario_creador_id
            WHERE s.id=$1
        `, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success:false, message:'Servicio no encontrado' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener servicio' });
    }
});

// POST /api/services
router.post('/', authMiddleware, requirePermission('servicios','crear'), async (req, res) => {
    try {
        const { nombre, descripcion, url_ruta, servidor, puerto, credenciales_referencia, estado } = req.body;
        if (!nombre) return res.status(400).json({ success:false, message:'El nombre es requerido' });

        const result = await db.query(`
            INSERT INTO app.services (nombre, descripcion, url_ruta, servidor, puerto, credenciales_referencia, estado, usuario_creador_id, usuario_actualizador_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *
        `, [nombre, descripcion, url_ruta||null, servidor||null, puerto||null, credenciales_referencia||null, estado||'activo', req.user.id]);

        res.status(201).json({ success: true, message: 'Servicio creado exitosamente', data: result.rows[0] });
    } catch (e) {
        console.error('Error creando servicio:', e);
        res.status(500).json({ success: false, message: 'Error al crear servicio' });
    }
});

// PUT /api/services/:id
router.put('/:id', authMiddleware, requirePermission('servicios','editar'), async (req, res) => {
    try {
        const { nombre, descripcion, url_ruta, servidor, puerto, credenciales_referencia, estado } = req.body;
        const result = await db.query(`
            UPDATE app.services SET
                nombre=COALESCE($1,nombre), descripcion=COALESCE($2,descripcion),
                url_ruta=COALESCE($3,url_ruta), servidor=COALESCE($4,servidor),
                puerto=COALESCE($5,puerto), credenciales_referencia=COALESCE($6,credenciales_referencia),
                estado=COALESCE($7,estado), usuario_actualizador_id=$8, updated_at=NOW()
            WHERE id=$9 RETURNING *
        `, [nombre, descripcion, url_ruta, servidor, puerto, credenciales_referencia, estado, req.user.id, req.params.id]);

        if (!result.rows.length) return res.status(404).json({ success:false, message:'Servicio no encontrado' });
        res.json({ success: true, message: 'Servicio actualizado', data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar servicio' });
    }
});

// DELETE /api/services/:id
router.delete('/:id', authMiddleware, requirePermission('servicios','eliminar'), async (req, res) => {
    try {
        const r = await db.query('DELETE FROM app.services WHERE id=$1 RETURNING *', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Servicio no encontrado' });
        res.json({ success: true, message: 'Servicio eliminado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar servicio' });
    }
});

module.exports = router;
