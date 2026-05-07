const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

// Get script statistics
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                COUNT(*)::integer as total,
                COUNT(*) FILTER (WHERE estado = 'activo')::integer as activos,
                COUNT(*) FILTER (WHERE estado = 'inactivo')::integer as inactivos,
                COUNT(*) FILTER (WHERE estado = 'mantenimiento')::integer as mantenimiento
            FROM app.scripts
        `);

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching script stats', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas de scripts'
        });
    }
});

// Get all scripts
router.get('/', authMiddleware, requirePermission('scripts', 'ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                s.*,
                ft.nombre as frecuencia_tipo_nombre,
                ft.codigo as frecuencia_tipo_codigo,
                ft.tipo_input as frecuencia_tipo_input,
                u1.username as created_by_username,
                u2.username as updated_by_username
            FROM app.scripts s
            LEFT JOIN app.script_frecuencia_tipos ft ON s.frecuencia_tipo_id = ft.id
            LEFT JOIN app.users u1 ON s.usuario_creador_id = u1.id
            LEFT JOIN app.users u2 ON s.usuario_actualizador_id = u2.id
            ORDER BY s.fecha_creacion DESC
        `);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        logger.error('Error fetching scripts', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al obtener scripts'
        });
    }
});

// Get script by ID
router.get('/:id', authMiddleware, requirePermission('scripts', 'ver'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT
                s.*,
                ft.nombre as frecuencia_tipo_nombre,
                ft.codigo as frecuencia_tipo_codigo,
                ft.tipo_input as frecuencia_tipo_input,
                u1.username as created_by_username,
                u2.username as updated_by_username
            FROM app.scripts s
            LEFT JOIN app.script_frecuencia_tipos ft ON s.frecuencia_tipo_id = ft.id
            LEFT JOIN app.users u1 ON s.usuario_creador_id = u1.id
            LEFT JOIN app.users u2 ON s.usuario_actualizador_id = u2.id
            WHERE s.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Script no encontrado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching script', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al obtener script'
        });
    }
});

// Create script
router.post('/', authMiddleware, requirePermission('scripts', 'crear'), async (req, res) => {
    try {
        const {
            nombre,
            descripcion,
            ruta_script,
            frecuencia_tipo_id,
            frecuencia_valor,
            hora_ejecucion,
            estado
        } = req.body;

        const userId = req.user.id;

        const result = await db.query(`
            INSERT INTO app.scripts (
                nombre, descripcion, ruta_script, frecuencia_tipo_id,
                frecuencia_valor, hora_ejecucion, estado,
                usuario_creador_id, usuario_actualizador_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
            RETURNING *
        `, [
            nombre,
            descripcion,
            ruta_script,
            frecuencia_tipo_id,
            frecuencia_valor,
            hora_ejecucion || null,
            estado || 'activo',
            userId
        ]);

        res.status(201).json({
            success: true,
            message: 'Script creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error creating script', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al crear script'
        });
    }
});

// Update script
router.put('/:id', authMiddleware, requirePermission('scripts', 'editar'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre,
            descripcion,
            ruta_script,
            frecuencia_tipo_id,
            frecuencia_valor,
            hora_ejecucion,
            estado
        } = req.body;

        const userId = req.user.id;

        const result = await db.query(`
            UPDATE app.scripts
            SET
                nombre = $1,
                descripcion = $2,
                ruta_script = $3,
                frecuencia_tipo_id = $4,
                frecuencia_valor = $5,
                hora_ejecucion = $6,
                estado = $7,
                usuario_actualizador_id = $8
            WHERE id = $9
            RETURNING *
        `, [
            nombre,
            descripcion,
            ruta_script,
            frecuencia_tipo_id,
            frecuencia_valor,
            hora_ejecucion || null,
            estado,
            userId,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Script no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Script actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error updating script', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al actualizar script'
        });
    }
});

// Delete script
router.delete('/:id', authMiddleware, requirePermission('scripts', 'eliminar'), async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'DELETE FROM app.scripts WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Script no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Script eliminado exitosamente'
        });
    } catch (error) {
        logger.error('Error deleting script', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al eliminar script'
        });
    }
});

module.exports = router;
