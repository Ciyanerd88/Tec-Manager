// backend/src/routes/admin.js
// ============================================================
// RUTAS ADMINISTRATIVAS — Módulos, Permisos, Auditoría
// Solo admin/superadmin (nivel >= 4) con rate limiting
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const adminRateLimiter = require('../middleware/adminRateLimit');
const { auditAction } = require('../middleware/auditMiddleware');

// Toda ruta requiere auth + admin + rate limit
router.use(authMiddleware);
router.use(adminMiddleware);
router.use(adminRateLimiter);

// ─────────────────────────────────────────────────────
// MÓDULOS CRUD
// ─────────────────────────────────────────────────────

// GET /api/admin/modules — todos los módulos (activos e inactivos)
router.get('/modules', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM app.asset_modules ORDER BY "order" ASC`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo módulos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener módulos' });
    }
});

// POST /api/admin/modules — crear módulo
router.post('/modules',
    auditAction('CREATE', 'asset_module'),
    async (req, res) => {
        try {
            const { key, label, icon, route, order, is_active, parent_key } = req.body;

            if (!key || !label) {
                return res.status(400).json({ success: false, message: 'key y label son requeridos' });
            }

            const result = await db.query(
                `INSERT INTO app.asset_modules (key, label, icon, route, "order", is_active, parent_key)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [key, label, icon || 'AppstoreOutlined', route || null, order || 0, is_active !== false, parent_key || null]
            );

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('Error creando módulo:', error);
            if (error.code === '23505') {
                return res.status(400).json({ success: false, message: 'Ya existe un módulo con ese key' });
            }
            res.status(500).json({ success: false, message: 'Error al crear módulo' });
        }
    }
);

// ──────────────────────────────────────────────────────────
// IMPORTANT: /modules-reorder MUST be defined BEFORE /modules/:id
// otherwise Express matches "modules-reorder" as ":id" parameter
// ──────────────────────────────────────────────────────────

// PUT /api/admin/modules-reorder — reordenar módulos
router.put('/modules-reorder', async (req, res) => {
    try {
        const { orders } = req.body; // [{ id, order }]

        if (!Array.isArray(orders)) {
            return res.status(400).json({ success: false, message: 'Se espera un array de {id, order}' });
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            for (const { id, order } of orders) {
                await client.query(
                    'UPDATE app.asset_modules SET "order" = $1 WHERE id = $2',
                    [order, id]
                );
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        res.json({ success: true, message: 'Orden actualizado' });
    } catch (error) {
        console.error('Error reordenando módulos:', error);
        res.status(500).json({ success: false, message: 'Error al reordenar' });
    }
});

// PUT /api/admin/modules/:id — actualizar módulo
router.put('/modules/:id',
    auditAction('UPDATE', 'asset_module', {
        getOldValue: async (req) => {
            const r = await db.query('SELECT * FROM app.asset_modules WHERE id = $1', [req.params.id]);
            return r.rows[0] || null;
        }
    }),
    async (req, res) => {
        try {
            const { key, label, icon, route, order, is_active, parent_key } = req.body;

            const result = await db.query(
                `UPDATE app.asset_modules
                 SET key        = COALESCE($1, key),
                     label      = COALESCE($2, label),
                     icon       = COALESCE($3, icon),
                     route      = $4,
                     "order"    = COALESCE($5, "order"),
                     is_active  = COALESCE($6, is_active),
                     parent_key = $7
                 WHERE id = $8
                 RETURNING *`,
                [key, label, icon, route ?? null, order, is_active, parent_key ?? null, req.params.id]
            );

            if (!result.rows.length) {
                return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
            }

            res.json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('Error actualizando módulo:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar módulo' });
        }
    }
);

// DELETE /api/admin/modules/:id — eliminar módulo
router.delete('/modules/:id',
    auditAction('DELETE', 'asset_module', {
        getOldValue: async (req) => {
            const r = await db.query('SELECT * FROM app.asset_modules WHERE id = $1', [req.params.id]);
            return r.rows[0] || null;
        }
    }),
    async (req, res) => {
        try {
            const result = await db.query(
                'DELETE FROM app.asset_modules WHERE id = $1 RETURNING *',
                [req.params.id]
            );

            if (!result.rows.length) {
                return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
            }

            // Limpiar permisos huérfanos
            await db.query(
                'DELETE FROM app.role_module_permissions WHERE module_key = $1',
                [result.rows[0].key]
            );

            // Limpiar hijos huérfanos (set parent_key = null)
            await db.query(
                'UPDATE app.asset_modules SET parent_key = NULL WHERE parent_key = $1',
                [result.rows[0].key]
            );

            res.json({ success: true, message: 'Módulo eliminado', data: result.rows[0] });
        } catch (error) {
            console.error('Error eliminando módulo:', error);
            res.status(500).json({ success: false, message: 'Error al eliminar módulo' });
        }
    }
);

// ─────────────────────────────────────────────────────
// PERMISOS POR ROL
// ─────────────────────────────────────────────────────

// GET /api/admin/permissions — matriz completa de permisos
router.get('/permissions', async (req, res) => {
    try {
        const roles = await db.query(
            'SELECT id, nombre, nivel, color FROM app.roles ORDER BY nivel ASC'
        );

        const modules = await db.query(
            'SELECT * FROM app.asset_modules ORDER BY "order" ASC'
        );

        const permissions = await db.query(
            'SELECT * FROM app.role_module_permissions'
        );

        // Construir matriz
        const matrix = {};
        for (const role of roles.rows) {
            matrix[role.id] = {};
            for (const mod of modules.rows) {
                const perm = permissions.rows.find(
                    p => p.role_id === role.id && p.module_key === mod.key
                );
                matrix[role.id][mod.key] = {
                    can_view: perm?.can_view || false,
                    can_edit: perm?.can_edit || false,
                };
            }
        }

        res.json({
            success: true,
            data: {
                roles: roles.rows,
                modules: modules.rows,
                matrix,
            }
        });
    } catch (error) {
        console.error('Error obteniendo permisos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener permisos' });
    }
});

// PUT /api/admin/permissions — actualizar matriz de permisos
router.put('/permissions',
    auditAction('UPDATE', 'role_module_permissions'),
    async (req, res) => {
        try {
            const { permissions } = req.body;
            // permissions: [{ role_id, module_key, can_view, can_edit }]

            if (!Array.isArray(permissions)) {
                return res.status(400).json({ success: false, message: 'Se espera un array de permisos' });
            }

            const client = await db.getClient();
            try {
                await client.query('BEGIN');

                for (const perm of permissions) {
                    await client.query(
                        `INSERT INTO app.role_module_permissions (role_id, module_key, can_view, can_edit)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (role_id, module_key)
                         DO UPDATE SET can_view = $3, can_edit = $4`,
                        [perm.role_id, perm.module_key, perm.can_view || false, perm.can_edit || false]
                    );
                }

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }

            res.json({ success: true, message: 'Permisos actualizados' });
        } catch (error) {
            console.error('Error actualizando permisos:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar permisos' });
        }
    }
);

// ─────────────────────────────────────────────────────
// AUDIT LOGS
// ─────────────────────────────────────────────────────

// GET /api/admin/audit — paginado con filtros (Solo SuperAdmin)
router.get('/audit', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            user_id,
            action,
            entity,
            date_from,
            date_to,
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        const conditions = [];

        // SuperAdmin ve todo, Admin solo ve sus propios logs
        if (req.user.rol_nivel < 5) {
            params.push(req.user.id);
            conditions.push(`al.user_id = $${params.length}`);
        }

        if (user_id && req.user.rol_nivel >= 5) {
            params.push(parseInt(user_id));
            conditions.push(`al.user_id = $${params.length}`);
        }

        if (action) {
            params.push(action);
            conditions.push(`al.action = $${params.length}`);
        }

        if (entity) {
            params.push(entity);
            conditions.push(`al.entity = $${params.length}`);
        }

        if (date_from) {
            params.push(date_from);
            conditions.push(`al.created_at >= $${params.length}::timestamptz`);
        }

        if (date_to) {
            params.push(date_to + 'T23:59:59');
            conditions.push(`al.created_at <= $${params.length}::timestamptz`);
        }

        const whereClause = conditions.length > 0
            ? 'WHERE ' + conditions.join(' AND ')
            : '';

        // Count total
        const countResult = await db.query(
            `SELECT count(*) FROM audit.audit_logs al ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        // Fetch page
        const dataParams = [...params, parseInt(limit), offset];
        const result = await db.query(
            `SELECT al.*,
                    u.username AS user_username,
                    CONCAT(p.primer_nombre, ' ', p.apellido) AS user_name
             FROM audit.audit_logs al
             LEFT JOIN app.users u ON u.id = al.user_id
             LEFT JOIN app.persons p ON p.id = u.persona_id
             ${whereClause}
             ORDER BY al.created_at DESC
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
            dataParams
        );

        // Distinct values for filters
        const actionsResult = await db.query(
            'SELECT DISTINCT action FROM audit.audit_logs ORDER BY action'
        );
        const entitiesResult = await db.query(
            'SELECT DISTINCT entity FROM audit.audit_logs WHERE entity IS NOT NULL ORDER BY entity'
        );

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
            filters: {
                actions: actionsResult.rows.map(r => r.action),
                entities: entitiesResult.rows.map(r => r.entity),
            }
        });
    } catch (error) {
        console.error('Error obteniendo audit logs:', error);
        res.status(500).json({ success: false, message: 'Error al obtener auditoría' });
    }
});

module.exports = router;
