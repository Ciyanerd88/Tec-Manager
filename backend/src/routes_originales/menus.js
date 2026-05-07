const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// All routes require authentication
router.use(authMiddleware);

// @route   GET /api/menus
// @desc    Get all active menus for the current user based on their role.
//          SuperAdmin (nivel 5) bypasses rol_menus and gets all active menus.
// @access  Private
router.get('/', async (req, res) => {
    try {
        // Get user's role_id and level
        const userResult = await db.query(
            `SELECT u.rol_id, r.nivel
             FROM app.users u
             INNER JOIN app.roles r ON r.id = u.rol_id
             WHERE u.id = $1 AND u.deleted_at IS NULL`,
            [req.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const { rol_id: rolId, nivel } = userResult.rows[0];
        const isSuperAdmin = nivel >= 5;

        let result;

        if (isSuperAdmin) {
            // SuperAdmin: get ALL active menus without restriction
            result = await db.query(`
                SELECT DISTINCT
                    m.id,
                    m.nombre,
                    m.titulo,
                    m.icono,
                    m.ruta,
                    m.parent_id,
                    m.orden,
                    m.permission_required
                FROM app.menus m
                WHERE m.activo = true
                ORDER BY m.parent_id NULLS FIRST, m.orden ASC
            `);
        } else {
            // Regular users: get menus allowed for this role
            result = await db.query(`
                SELECT DISTINCT
                    m.id,
                    m.nombre,
                    m.titulo,
                    m.icono,
                    m.ruta,
                    m.parent_id,
                    m.orden,
                    m.permission_required
                FROM app.menus m
                INNER JOIN app.rol_menus rm ON rm.menu_id = m.id
                WHERE rm.rol_id = $1
                  AND m.activo = true
                ORDER BY m.parent_id NULLS FIRST, m.orden ASC
            `, [rolId]);
        }

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo menús:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener menús'
        });
    }
});

// @route   GET /api/menus/all
// @desc    Get ALL menu items (for superadmin management)
// @access  Private (SuperAdmin only)
router.get('/all', async (req, res) => {
    if (!req.user?.rol_nivel || req.user.rol_nivel < 5) {
        return res.status(403).json({ success: false, message: 'Se requiere rol Super Admin' });
    }
    try {
        const result = await db.query(`
            SELECT * FROM app.menus ORDER BY parent_id NULLS FIRST, orden ASC
        `);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo todos los menús:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener menús'
        });
    }
});

// @route   GET /api/menus/role/:roleId
// @desc    Get menu IDs assigned to a specific role
// @access  Private (SuperAdmin only)
router.get('/role/:roleId', async (req, res) => {
    if (!req.user?.rol_nivel || req.user.rol_nivel < 5) {
        return res.status(403).json({ success: false, message: 'Se requiere rol Super Admin' });
    }
    try {
        const { roleId } = req.params;

        const result = await db.query(`
            SELECT m.id
            FROM app.menus m
            INNER JOIN app.rol_menus rm ON rm.menu_id = m.id
            WHERE rm.rol_id = $1 AND m.activo = true
        `, [roleId]);

        res.json({
            success: true,
            data: result.rows.map(r => r.id)
        });
    } catch (error) {
        console.error('Error obteniendo menús del rol:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener menús del rol'
        });
    }
});

// @route   PUT /api/menus/role/:roleId
// @desc    Update menus assigned to a role (SuperAdmin only)
// @access  Private (SuperAdmin only)
router.put('/role/:roleId', async (req, res) => {
    if (!req.user?.rol_nivel || req.user.rol_nivel < 5) {
        return res.status(403).json({ success: false, message: 'Se requiere rol Super Admin' });
    }
    try {
        const { roleId } = req.params;
        const { menuIds } = req.body;

        if (!Array.isArray(menuIds)) {
            return res.status(400).json({
                success: false,
                message: 'menuIds debe ser un array'
            });
        }

        // Verify role exists
        const roleCheck = await db.query('SELECT id, nombre FROM app.roles WHERE id = $1', [roleId]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Rol no encontrado'
            });
        }

        // Delete existing menu assignments for this role
        await db.query('DELETE FROM app.rol_menus WHERE rol_id = $1', [roleId]);

        // Insert new menu assignments
        for (const menuId of menuIds) {
            await db.query(`
                INSERT INTO app.rol_menus (rol_id, menu_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
            `, [roleId, menuId]);
        }

        res.json({
            success: true,
            message: `Menús del rol "${roleCheck.rows[0].nombre}" actualizados exitosamente`
        });
    } catch (error) {
        console.error('Error actualizando menús del rol:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar menús del rol'
        });
    }
});

// @route   GET /api/menus/:id
// @desc    Get single menu item
// @access  Private
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'SELECT * FROM app.menus WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menú no encontrado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error obteniendo menú:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener menú'
        });
    }
});

// @route   POST /api/menus
// @desc    Create new menu item (admin only)
// @access  Private/Admin
router.post('/', async (req, res) => {
    try {
        const {
            nombre,
            titulo,
            icono,
            ruta,
            parent_id,
            orden,
            permission_required
        } = req.body;

        if (!nombre || !titulo) {
            return res.status(400).json({
                success: false,
                message: 'Nombre y título son requeridos'
            });
        }

        const result = await db.query(`
            INSERT INTO app.menus (nombre, titulo, icono, ruta, parent_id, orden, permission_required)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [nombre, titulo, icono, ruta, parent_id, orden || 0, permission_required]);

        res.status(201).json({
            success: true,
            message: 'Menú creado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error creando menú:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear menú'
        });
    }
});

// @route   PUT /api/menus/:id
// @desc    Update menu item (admin only)
// @access  Private/Admin
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre,
            titulo,
            icono,
            ruta,
            parent_id,
            orden,
            activo,
            permission_required
        } = req.body;

        const result = await db.query(`
            UPDATE app.menus
            SET nombre = COALESCE($1, nombre),
                titulo = COALESCE($2, titulo),
                icono = COALESCE($3, icono),
                ruta = COALESCE($4, ruta),
                parent_id = COALESCE($5, parent_id),
                orden = COALESCE($6, orden),
                activo = COALESCE($7, activo),
                permission_required = COALESCE($8, permission_required)
            WHERE id = $9
            RETURNING *
        `, [nombre, titulo, icono, ruta, parent_id, orden, activo, permission_required, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menú no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Menú actualizado exitosamente',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error actualizando menú:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar menú'
        });
    }
});

// @route   DELETE /api/menus/:id
// @desc    Delete menu item (admin only)
// @access  Private/Admin
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'DELETE FROM app.menus WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Menú no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Menú eliminado exitosamente'
        });
    } catch (error) {
        console.error('Error eliminando menú:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar menú'
        });
    }
});

module.exports = router;
