// backend/src/routes/menus.js
// ============================================================
// RUTAS DE MENÚS
// Menú dinámico basado en rol — consulta DB en cada refresh
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');
const { requirePermission, menuGuard }         = require('../middleware/permissions');


// ============================================================
// GET /api/menus/mis-menus
// Devuelve el árbol de menús del usuario autenticado.
// Llamado al cargar la app y en cada refresh de sesión.
// ============================================================
router.get('/mis-menus', authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT id, nombre, titulo, icono_css, ruta, parent_id, orden FROM app.sp_get_menus_usuario($1)',
            [req.user.id]
        );

        // Construir árbol padre-hijo en JS
        const menuMap = {};
        const roots   = [];

        rows.forEach(m => {
            menuMap[m.id] = { ...m, hijos: [] };
        });

        rows.forEach(m => {
            if (m.parent_id && menuMap[m.parent_id]) {
                menuMap[m.parent_id].hijos.push(menuMap[m.id]);
            } else {
                roots.push(menuMap[m.id]);
            }
        });

        // Ordenar raíces y sus hijos
        roots.sort((a, b) => a.orden - b.orden);
        roots.forEach(root => {
            if (root.hijos && root.hijos.length > 0) {
                root.hijos.sort((a, b) => a.orden - b.orden);
            }
        });

        res.json({ success: true, menus: roots });
    } catch (err) {
        console.error('GET /menus/mis-menus:', err);
        res.status(500).json({ success: false, message: 'Error al cargar menús' });
    }
});


// ============================================================
// GET /api/menus — listar menús para sidebar o gestión
// ============================================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        // Si viene con el parámetro management, verificamos permisos (solo admin)
        if (req.query.management === 'true') {
            // Verificar nivel de admin (nivel >= 4)
            if (req.user.rol_nivel < 4) {
                return res.status(403).json({ success: false, message: 'Acceso denegado a gestión de menús' });
            }

            const { rows } = await db.query(`
                SELECT
                    m.*,
                    parent.titulo AS parent_titulo
                FROM app.menus m
                LEFT JOIN app.menus parent ON parent.id = m.parent_id
                ORDER BY m.parent_id NULLS FIRST, m.orden
            `);

            // Para la vista de escalera, el frontend puede manejar la indentación,
            // pero si queremos devolver un árbol real:
            const buildTree = (menus) => {
                const map = {};
                const roots = [];
                menus.forEach(m => {
                    map[m.id] = { ...m, children: [] };
                });
                menus.forEach(m => {
                    if (m.parent_id && map[m.parent_id]) {
                        map[m.parent_id].children.push(map[m.id]);
                    } else if (!m.parent_id) {
                        roots.push(map[m.id]);
                    }
                });
                return roots;
            };

            return res.json({ success: true, data: buildTree(rows) });
        }

        // POR DEFECTO: Carga de Sidebar (lista plana compatible)
        const { rows } = await db.query(
            'SELECT id, nombre, titulo, icono_css, icono_css as icono, ruta, parent_id, orden, permission_required FROM app.sp_get_menus_usuario($1)',
            [req.user.id]
        );
        res.json({ success: true, data: rows });

    } catch (err) {
        console.error('GET /menus:', err);
        res.status(500).json({ success: false, message: 'Error al obtener menús' });
    }
});


// ============================================================
// POST /api/menus — crear menú (solo SuperAdmin)
// ============================================================
router.post('/', authMiddleware, requirePermission('menus.manage'), async (req, res) => {
    try {
        const { nombre, titulo, icono_css, ruta, parent_id, orden = 0, permission_required } = req.body;

        if (!nombre || !titulo || !icono_css) {
            return res.status(400).json({
                success: false,
                message: 'nombre, titulo e icono_css son requeridos'
            });
        }

        const { rows } = await db.query(`
            INSERT INTO app.menus (nombre, titulo, icono_css, ruta, parent_id, orden, permission_required)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [nombre, titulo, icono_css, ruta || null, parent_id || null, orden, permission_required || null]);

        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Ya existe un menú con ese nombre o ícono CSS'
            });
        }
        console.error('POST /menus:', err);
        res.status(500).json({ success: false, message: 'Error al crear menú' });
    }
});


// ============================================================
// PUT /api/menus/:id — editar menú (solo SuperAdmin)
// ============================================================
router.put('/:id', authMiddleware, requirePermission('menus.manage'), async (req, res) => {
    try {
        const { titulo, icono_css, ruta, parent_id, orden, activo, permission_required } = req.body;

        const { rows } = await db.query(`
            UPDATE app.menus
            SET
                titulo              = COALESCE($1, titulo),
                icono_css           = COALESCE($2, icono_css),
                ruta                = COALESCE($3, ruta),
                parent_id           = $4,
                orden               = COALESCE($5, orden),
                activo              = COALESCE($6, activo),
                permission_required = $7
            WHERE id = $8
            RETURNING *
        `, [titulo, icono_css, ruta, parent_id, orden, activo, permission_required, req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Menú no encontrado' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Ese ícono CSS ya está en uso por otro menú'
            });
        }
        console.error('PUT /menus/:id:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar menú' });
    }
});


// ============================================================
// GET /api/menus/role/:rol_id — obtener menús de un rol
// ============================================================
router.get('/role/:rol_id', authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT menu_id FROM app.rol_menus WHERE rol_id = $1',
            [req.params.rol_id]
        );
        // Devolvemos solo un array de IDs para facilitar el check en el frontend
        res.json({ success: true, data: rows.map(r => r.menu_id) });
    } catch (err) {
        console.error('GET /menus/role/:rol_id:', err);
        res.status(500).json({ success: false, message: 'Error al obtener menús del rol' });
    }
});


// ============================================================
// PUT /api/menus/role/:rol_id — asignar menús a un rol
// ============================================================
router.put('/role/:rol_id', authMiddleware, requirePermission('menus.manage'), async (req, res) => {
    const { menu_ids } = req.body;
    const rol_id = parseInt(req.params.rol_id);

    if (!Array.isArray(menu_ids)) {
        return res.status(400).json({ success: false, message: 'menu_ids debe ser un array' });
    }

    // Usar cliente dedicado para garantizar que BEGIN/COMMIT van por la misma conexión
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM app.rol_menus WHERE rol_id = $1', [rol_id]);

        if (menu_ids.length > 0) {
            const values = menu_ids.map((mid, i) => `($1, $${i + 2})`).join(', ');
            await client.query(
                `INSERT INTO app.rol_menus (rol_id, menu_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                [rol_id, ...menu_ids]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Menús del rol actualizados' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('PUT /menus/rol/:rol_id:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar menús del rol' });
    } finally {
        client.release();
    }
});


// ============================================================
// GET /api/menus/user/:user_id — obtener menús excepcionales de un usuario
// ============================================================
router.get('/user/:user_id', authMiddleware, async (req, res) => {
    try {
        const userRes = await db.query('SELECT custom_navigation FROM app.users WHERE id = $1', [req.params.user_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        const custom_navigation = userRes.rows[0].custom_navigation || false;

        const { rows } = await db.query(
            'SELECT menu_id FROM app.user_menus WHERE user_id = $1',
            [req.params.user_id]
        );
        res.json({ success: true, custom_navigation, data: rows.map(r => r.menu_id) });
    } catch (err) {
        console.error('GET /menus/user/:user_id:', err);
        res.status(500).json({ success: false, message: 'Error al obtener menús del usuario' });
    }
});

// ============================================================
// PUT /api/menus/user/:user_id — asignar menús excepcionales a un usuario
// ============================================================
router.put('/user/:user_id', authMiddleware, requirePermission('menus.manage'), async (req, res) => {
    const { menu_ids, custom_navigation } = req.body;
    const user_id = parseInt(req.params.user_id);

    if (!Array.isArray(menu_ids)) {
        return res.status(400).json({ success: false, message: 'menu_ids debe ser un array' });
    }

    try {
        // Enforce hierarchy
        const targetUserRes = await db.query(`
            SELECT r.nivel as rol_nivel
            FROM app.users u
            LEFT JOIN app.roles r ON r.id = u.rol_id
            WHERE u.id = $1
        `, [user_id]);

        if (targetUserRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const targetNivel = targetUserRes.rows[0].rol_nivel || 0;
        const myNivel = req.user.rol_nivel || 0;
        const isSuperAdmin = myNivel >= 5 || req.user.rol === 'superadmin';

        if (!isSuperAdmin && myNivel <= targetNivel) {
            return res.status(403).json({ success: false, message: 'No tienes permisos para modificar usuarios de tu mismo nivel o superior' });
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            
            // Set custom_navigation flag
            await client.query('UPDATE app.users SET custom_navigation = $1 WHERE id = $2', [
                custom_navigation === true, 
                user_id
            ]);

            await client.query('DELETE FROM app.user_menus WHERE user_id = $1', [user_id]);

            if (custom_navigation && menu_ids.length > 0) {
                const values = menu_ids.map((mid, i) => `($1, $${i + 2})`).join(', ');
                await client.query(
                    `INSERT INTO app.user_menus (user_id, menu_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                    [user_id, ...menu_ids]
                );
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Menús del usuario actualizados exitosamente' });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('PUT /menus/user/:user_id:', err);
            res.status(500).json({ success: false, message: 'Error al actualizar menús del usuario' });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error verificando jerarquía:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ============================================================
// DELETE /api/menus/:id — Soft Delete de menú (solo SuperAdmin)
// ============================================================
router.delete('/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(`
            UPDATE app.menus
            SET activo = false
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Menú no encontrado' });
        }

        res.json({ success: true, message: 'Menú desactivado correctamente', data: rows[0] });
    } catch (err) {
        console.error('DELETE /menus/:id:', err);
        res.status(500).json({ success: false, message: 'Error al desactivar el menú' });
    }
});

module.exports = router;
