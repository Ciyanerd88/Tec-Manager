const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

// Get all infrastructure records
router.get('/', authMiddleware, requirePermission('infraestructura', 'ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                i.*,
                s.nombre as servicio_nombre
            FROM app.infraestructura i
            LEFT JOIN app.services s ON i.servicio_id = s.id
            ORDER BY i.fecha_creacion DESC
        `);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        logger.error('Error fetching infrastructure', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros de infraestructura'
        });
    }
});

// Create infrastructure record
router.post('/', authMiddleware, requirePermission('infraestructura', 'crear'), async (req, res) => {
    try {
        const {
            servicio_id,
            tipo,
            ip,
            puerto,
            estado,
            notas
        } = req.body;

        const result = await db.query(`
            INSERT INTO app.infraestructura (
                servicio_id, tipo, ip, puerto, estado, notas
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            servicio_id,
            tipo,
            ip,
            puerto,
            estado || 'activo',
            notas
        ]);

        res.status(201).json({
            success: true,
            message: 'Registro de infraestructura creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error creating infrastructure', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al crear registro de infraestructura'
        });
    }
});

// Update infrastructure record
router.put('/:id', authMiddleware, requirePermission('infraestructura', 'editar'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            servicio_id,
            tipo,
            ip,
            puerto,
            estado,
            notas
        } = req.body;

        const result = await db.query(`
            UPDATE app.infraestructura
            SET
                servicio_id = $1,
                tipo = $2,
                ip = $3,
                puerto = $4,
                estado = $5,
                notas = $6,
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING *
        `, [
            servicio_id,
            tipo,
            ip,
            puerto,
            estado,
            notas,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro de infraestructura no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Registro de infraestructura actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error updating infrastructure', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al actualizar registro de infraestructura'
        });
    }
});

// Delete infrastructure record
router.delete('/:id', authMiddleware, requirePermission('infraestructura', 'eliminar'), async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'DELETE FROM app.infraestructura WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro de infraestructura no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Registro de infraestructura eliminado exitosamente'
        });
    } catch (error) {
        logger.error('Error deleting infrastructure', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al eliminar registro de infraestructura'
        });
    }
});

module.exports = router;
