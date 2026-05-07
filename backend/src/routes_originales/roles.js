const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Helper: check if requesting user is superadmin
const isSuperAdmin = (req) => (req.user.rol_nivel >= 5) || req.user.rol === 'superadmin';
// Helper: check if user can manage permissions (superadmin, admin o tecnico nivel>=3)
const canManagePerms = (req) => (req.user.rol_nivel >= 3) || ['superadmin','admin','tecnico'].includes(req.user.rol);

// All routes require authentication
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────
// GET /api/roles  —  Listar todos los roles con sus permisos
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT r.*,
                   COALESCE(
                     json_agg(
                       json_build_object(
                         'id', p.id,
                         'nombre', p.nombre,
                         'modulo', p.modulo,
                         'accion', p.accion,
                         'descripcion', p.descripcion
                       )
                     ) FILTER (WHERE p.id IS NOT NULL), '[]'
                   ) AS permisos
            FROM app.roles r
            LEFT JOIN app.rol_permissions rp ON r.id = rp.rol_id
            LEFT JOIN app.permissions p ON rp.permiso_id = p.id
            GROUP BY r.id
            ORDER BY r.nivel DESC, r.id
        `);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo roles:', error);
        res.status(500).json({ success: false, message: 'Error al obtener roles' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/roles/permissions  —  Todos los permisos disponibles
// ─────────────────────────────────────────────────────────────
router.get('/permissions', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM app.permissions ORDER BY modulo, accion'
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo permisos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener permisos' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/roles/:id  —  Un rol con sus permisos
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT r.*,
                   COALESCE(
                     json_agg(
                       json_build_object(
                         'id', p.id,
                         'nombre', p.nombre,
                         'modulo', p.modulo,
                         'accion', p.accion,
                         'descripcion', p.descripcion
                       )
                     ) FILTER (WHERE p.id IS NOT NULL), '[]'
                   ) AS permisos
            FROM app.roles r
            LEFT JOIN app.rol_permissions rp ON r.id = rp.rol_id
            LEFT JOIN app.permissions p ON rp.permiso_id = p.id
            WHERE r.id = $1
            GROUP BY r.id
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rol no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error obteniendo rol:', error);
        res.status(500).json({ success: false, message: 'Error al obtener rol' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /api/roles  —  Crear rol nuevo
// ─────────────────────────────────────────────────────────────
router.post('/', adminMiddleware, async (req, res) => {
    try {
        const { nombre, descripcion, color, permissionIds } = req.body;

        if (!nombre) {
            return res.status(400).json({ success: false, message: 'El nombre del rol es requerido' });
        }

        const existing = await db.query('SELECT id FROM app.roles WHERE nombre = $1', [nombre]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe un rol con ese nombre' });
        }

        const result = await db.query(`
            INSERT INTO app.roles (nombre, descripcion, es_sistema, color)
            VALUES ($1, $2, false, $3)
            RETURNING *
        `, [nombre, descripcion, color || '#1890ff']);

        const newRole = result.rows[0];

        if (permissionIds && Array.isArray(permissionIds) && permissionIds.length > 0) {
            for (const pId of permissionIds) {
                await db.query(
                    'INSERT INTO app.rol_permissions (rol_id, permiso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [newRole.id, pId]
                );
            }
        }

        res.status(201).json({ success: true, message: 'Rol creado exitosamente', data: newRole });
    } catch (error) {
        console.error('Error creando rol:', error);
        res.status(500).json({ success: false, message: 'Error al crear rol' });
    }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/roles/:id  —  Actualizar rol (info + permisos en lote)
// ─────────────────────────────────────────────────────────────
router.put('/:id', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, color, permissionIds } = req.body;

        const roleCheck = await db.query('SELECT es_sistema FROM app.roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rol no encontrado' });
        }

        const result = await db.query(`
            UPDATE app.roles
            SET nombre      = COALESCE($1, nombre),
                descripcion = COALESCE($2, descripcion),
                color       = COALESCE($3, color)
            WHERE id = $4
            RETURNING *
        `, [nombre, descripcion, color, id]);

        if (permissionIds && Array.isArray(permissionIds)) {
            await db.query('DELETE FROM app.rol_permissions WHERE rol_id = $1', [id]);
            for (const pId of permissionIds) {
                await db.query(
                    'INSERT INTO app.rol_permissions (rol_id, permiso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [id, pId]
                );
            }
        }

        res.json({ success: true, message: 'Rol actualizado exitosamente', data: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar rol' });
    }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/roles/:id/permissions/:permId  —  Toggle individual
//   Permite marcar/desmarcar UN permiso con un solo click
//   Accesible para superadmin, admin y tecnico
// ─────────────────────────────────────────────────────────────
router.patch('/:id/permissions/:permId', async (req, res) => {
    try {
        // Solo superadmin / admin / tecnico pueden gestionar permisos
        if (!canManagePerms(req)) {
            return res.status(403).json({
                success: false,
                message: 'No tenés permisos para gestionar permisos de roles'
            });
        }

        const { id: roleId, permId } = req.params;
        const { enabled } = req.body; // true = agregar, false = quitar

        // Verificar que el rol exista
        const roleCheck = await db.query('SELECT id, es_sistema FROM app.roles WHERE id = $1', [roleId]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rol no encontrado' });
        }
        // Solo superadmin puede tocar roles de sistema
        if (roleCheck.rows[0].es_sistema && !isSuperAdmin(req)) {
            return res.status(403).json({
                success: false,
                message: 'Solo el Super Admin puede modificar roles del sistema'
            });
        }

        if (enabled) {
            await db.query(
                'INSERT INTO app.rol_permissions (rol_id, permiso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [roleId, permId]
            );
        } else {
            await db.query(
                'DELETE FROM app.rol_permissions WHERE rol_id = $1 AND permiso_id = $2',
                [roleId, permId]
            );
        }

        res.json({
            success: true,
            message: enabled ? 'Permiso otorgado' : 'Permiso revocado',
            enabled
        });
    } catch (error) {
        console.error('Error en toggle de permiso:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar permiso' });
    }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/roles/:id/permissions  —  Reemplazar todos los permisos
// ─────────────────────────────────────────────────────────────
router.put('/:id/permissions', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { permisos } = req.body;

        if (!permisos || !Array.isArray(permisos)) {
            return res.status(400).json({ success: false, message: 'Se requiere un array de permisos' });
        }

        const roleCheck = await db.query('SELECT es_sistema FROM app.roles WHERE id = $1', [id]);
        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rol no encontrado' });
        }
        if (roleCheck.rows[0].es_sistema && !isSuperAdmin(req)) {
            return res.status(403).json({
                success: false,
                message: 'Solo el Super Admin puede modificar roles del sistema'
            });
        }

        await db.query('DELETE FROM app.rol_permissions WHERE rol_id = $1', [id]);
        for (const permissionId of permisos) {
            await db.query(
                'INSERT INTO app.rol_permissions (rol_id, permiso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [id, permissionId]
            );
        }

        res.json({ success: true, message: 'Permisos actualizados exitosamente' });
    } catch (error) {
        console.error('Error actualizando permisos:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar permisos' });
    }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/roles/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const roleCheck = await db.query('SELECT es_sistema FROM app.roles WHERE id = $1', [id]);

        if (roleCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rol no encontrado' });
        }
        if (roleCheck.rows[0].es_sistema) {
            return res.status(403).json({ success: false, message: 'No se pueden eliminar roles del sistema' });
        }

        await db.query('DELETE FROM app.roles WHERE id = $1', [id]);
        res.json({ success: true, message: 'Rol eliminado exitosamente' });
    } catch (error) {
        console.error('Error eliminando rol:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar rol' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/roles/user/:userId/permissions  —  Permisos de un usuario específico
// ─────────────────────────────────────────────────────────────
router.get('/user/:userId/permissions', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Primero obtenemos el rol del usuario
        const userResult = await db.query('SELECT rol_id FROM app.users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        
        const rolId = userResult.rows[0].rol_id;
        
        // Luego obtenemos todos los permisos de ese rol
        const result = await db.query(`
            SELECT p.*
            FROM app.permissions p
            INNER JOIN app.rol_permissions rp ON p.id = rp.permiso_id
            WHERE rp.rol_id = $1
        `, [rolId]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo permisos del usuario:', error);
        res.status(500).json({ success: false, message: 'Error al obtener permisos del usuario' });
    }
});

module.exports = router;
