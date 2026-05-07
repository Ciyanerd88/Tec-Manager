const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

// @desc    Get all frequency types
// @route   GET /api/script-frecuencia-tipos
// @access  Protected
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM app.script_frecuencia_tipos WHERE estado = $1 ORDER BY nombre ASC',
            ['activo']
        );
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        logger.error('Error fetching frequency types', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al obtener tipos de frecuencia'
        });
    }
});

// @desc    Create a frequency type
// @route   POST /api/script-frecuencia-tipos
// @access  Protected (Admin only)
router.post('/', authMiddleware, requirePermission('script_frecuencia_tipos', 'crear'), async (req, res) => {
    const { nombre, codigo, tipo_input, label_ayuda, descripcion } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO app.script_frecuencia_tipos (nombre, codigo, tipo_input, label_ayuda, descripcion) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [nombre, codigo, tipo_input, label_ayuda, descripcion]
        );
        res.status(201).json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error creating frequency type', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al crear tipo de frecuencia'
        });
    }
});

// @desc    Update a frequency type
// @route   PUT /api/script-frecuencia-tipos/:id
// @access  Protected (Admin only)
router.put('/:id', authMiddleware, requirePermission('script_frecuencia_tipos', 'editar'), async (req, res) => {
    const { nombre, codigo, tipo_input, label_ayuda, descripcion, estado } = req.body;
    try {
        const result = await db.query(
            'UPDATE app.script_frecuencia_tipos SET nombre = $1, codigo = $2, tipo_input = $3, label_ayuda = $4, descripcion = $5, estado = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
            [nombre, codigo, tipo_input, label_ayuda, descripcion, estado, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tipo de frecuencia no encontrado' });
        }
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error updating frequency type', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al actualizar tipo de frecuencia'
        });
    }
});

// @desc    Delete (deactivate) a frequency type
// @route   DELETE /api/script-frecuencia-tipos/:id
// @access  Protected (Admin only)
router.delete('/:id', authMiddleware, requirePermission('script_frecuencia_tipos', 'eliminar'), async (req, res) => {
    try {
        const result = await db.query(
            'UPDATE app.script_frecuencia_tipos SET estado = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['inactivo', req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tipo de frecuencia no encontrado' });
        }
        res.json({
            success: true,
            message: 'Tipo de frecuencia desactivado correctamente'
        });
    } catch (error) {
        logger.error('Error deleting frequency type', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al eliminar tipo de frecuencia'
        });
    }
});

module.exports = router;
