const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const checkAdmin = (req, res, next) => {
    if (req.user?.rol_nivel >= 4) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Administrador' });
};

// GET /api/databases/stats
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                COUNT(*)::integer as total,
                COUNT(*) FILTER (WHERE estado = 'activo')::integer as activos,
                COUNT(*) FILTER (WHERE estado = 'inactivo')::integer as inactivos,
                COUNT(*) FILTER (WHERE estado = 'mantenimiento')::integer as mantenimiento
            FROM app.databases
        `);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error('Error fetching database stats', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener estadísticas de bases de datos' });
    }
});

// GET /api/databases
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT d.*,
                   u1.username as created_by_username,
                   u2.username as updated_by_username
            FROM app.databases d
            LEFT JOIN app.users u1 ON d.usuario_creador_id = u1.id
            LEFT JOIN app.users u2 ON d.usuario_actualizador_id = u2.id
            ORDER BY d.fecha_creacion DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        logger.error('Error fetching databases', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener bases de datos' });
    }
});

// GET /api/databases/:id
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT d.*,
                   u1.username as created_by_username,
                   u2.username as updated_by_username
            FROM app.databases d
            LEFT JOIN app.users u1 ON d.usuario_creador_id = u1.id
            LEFT JOIN app.users u2 ON d.usuario_actualizador_id = u2.id
            WHERE d.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Base de datos no encontrada' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error('Error fetching database', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener base de datos' });
    }
});

// POST /api/databases — solo Admin+
router.post('/', authMiddleware, checkAdmin, async (req, res) => {
    try {
        const {
            nombre, descripcion, tipo_bd, servidor, puerto,
            nombre_bd, credenciales_usuario, credenciales_password, estado
        } = req.body;

        if (!nombre) {
            return res.status(400).json({ success: false, message: 'El nombre es requerido' });
        }

        const result = await db.query(`
            INSERT INTO app.databases (
                nombre, descripcion, tipo_bd, servidor, puerto, nombre_bd,
                credenciales_usuario, credenciales_password, estado,
                usuario_creador_id, usuario_actualizador_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *
        `, [
            nombre, descripcion, tipo_bd, servidor, puerto, nombre_bd,
            credenciales_usuario, credenciales_password,
            estado || 'activo', req.user.id
        ]);

        res.status(201).json({ success: true, message: 'Base de datos creada exitosamente', data: result.rows[0] });
    } catch (error) {
        logger.error('Error creating database', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al crear base de datos' });
    }
});

// PUT /api/databases/:id — solo Admin+
router.put('/:id', authMiddleware, checkAdmin, async (req, res) => {
    try {
        const {
            nombre, descripcion, tipo_bd, servidor, puerto,
            nombre_bd, credenciales_usuario, credenciales_password, estado
        } = req.body;

        const result = await db.query(`
            UPDATE app.databases SET
                nombre = $1, descripcion = $2, tipo_bd = $3, servidor = $4,
                puerto = $5, nombre_bd = $6, credenciales_usuario = $7,
                credenciales_password = $8, estado = $9,
                usuario_actualizador_id = $10, fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id = $11 RETURNING *
        `, [
            nombre, descripcion, tipo_bd, servidor, puerto,
            nombre_bd, credenciales_usuario, credenciales_password,
            estado, req.user.id, req.params.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Base de datos no encontrada' });
        }
        res.json({ success: true, message: 'Base de datos actualizada exitosamente', data: result.rows[0] });
    } catch (error) {
        logger.error('Error updating database', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al actualizar base de datos' });
    }
});

// DELETE /api/databases/:id — solo Admin+
router.delete('/:id', authMiddleware, checkAdmin, async (req, res) => {
    try {
        const result = await db.query('DELETE FROM app.databases WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Base de datos no encontrada' });
        }
        res.json({ success: true, message: 'Base de datos eliminada exitosamente' });
    } catch (error) {
        logger.error('Error deleting database', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al eliminar base de datos' });
    }
});

module.exports = router;
