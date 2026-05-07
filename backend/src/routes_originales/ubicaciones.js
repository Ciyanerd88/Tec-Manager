const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// GET /api/ubicaciones — accesible a cualquier usuario autenticado (se usa como lista de referencia en tickets)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { tipo } = req.query;
        const params = [];
        let where = '';
        if (tipo) {
            params.push(tipo);
            where = `WHERE tipo = $1`;
        }
        const result = await db.query(
            `SELECT * FROM app.ubicaciones ${where} ORDER BY tipo, nombre ASC`,
            params
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo ubicaciones:', e);
        res.status(500).json({ success: false, message: 'Error al obtener ubicaciones' });
    }
});

// GET /api/ubicaciones/:id
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM app.ubicaciones WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener registro' });
    }
});

// POST /api/ubicaciones
router.post('/', authMiddleware, requirePermission('ubicaciones', 'crear'), async (req, res) => {
    try {
        const { tipo, nombre, descripcion, activo = true } = req.body;
        if (!tipo || !nombre) {
            return res.status(400).json({ success: false, message: 'Tipo y nombre son requeridos' });
        }
        const result = await db.query(
            `INSERT INTO app.ubicaciones (tipo, nombre, descripcion, activo)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [tipo, nombre.trim(), descripcion || null, activo]
        );
        res.status(201).json({ success: true, message: 'Registro creado exitosamente', data: result.rows[0] });
    } catch (e) {
        console.error('Error creando ubicacion:', e);
        res.status(500).json({ success: false, message: 'Error al crear registro' });
    }
});

// PUT /api/ubicaciones/:id
router.put('/:id', authMiddleware, requirePermission('ubicaciones', 'editar'), async (req, res) => {
    try {
        const { tipo, nombre, descripcion, activo } = req.body;
        const result = await db.query(
            `UPDATE app.ubicaciones
             SET tipo        = COALESCE($1, tipo),
                 nombre      = COALESCE($2, nombre),
                 descripcion = $3,
                 activo      = COALESCE($4, activo),
                 updated_at  = NOW()
             WHERE id = $5 RETURNING *`,
            [tipo, nombre?.trim() || null, descripcion ?? null, activo, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        res.json({ success: true, message: 'Registro actualizado', data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar registro' });
    }
});

// DELETE /api/ubicaciones/:id
router.delete('/:id', authMiddleware, requirePermission('ubicaciones', 'eliminar'), async (req, res) => {
    try {
        const r = await db.query('DELETE FROM app.ubicaciones WHERE id = $1 RETURNING *', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
        res.json({ success: true, message: 'Registro eliminado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar registro' });
    }
});

module.exports = router;
