// backend/src/middleware/permissions.js
// ============================================================
// MIDDLEWARE DE PERMISOS
// Toda validación consulta DB — nunca confía solo en el JWT
// ============================================================

const db = require('../config/db');

/**
 * requirePermission(permissionName)
 * Verifica que el usuario tenga el permiso exacto requerido.
 * Consulta SIEMPRE la DB via SP.
 *
 * @param {string} permissionName - ej: 'tickets.create', 'usuarios.delete'
 *
 * Uso: router.get('/users', authMiddleware, requirePermission('usuarios.read'), handler)
 */
const requirePermission = (permissionName) => {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ success: false, message: 'No autenticado' });
            }

            const { rows } = await db.query(
                'SELECT tiene_permiso, rol_nivel, usuario_activo FROM app.sp_verificar_permiso($1, $2)',
                [req.user.id, permissionName]
            );

            if (rows.length === 0) {
                return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
            }

            const { tiene_permiso, usuario_activo } = rows[0];

            if (!usuario_activo) {
                return res.status(403).json({ success: false, message: 'Cuenta deshabilitada' });
            }

            if (!tiene_permiso) {
                return res.status(403).json({
                    success: false,
                    message: `No tenés el permiso requerido: ${permissionName}`
                });
            }

            next();
        } catch (error) {
            console.error('Error en requirePermission:', error);
            return res.status(500).json({ success: false, message: 'Error al verificar permisos' });
        }
    };
};


/**
 * verifyTicketAction(action)
 * Delega la validación al SP en DB.
 * La DB decide qué puede hacer cada rol sobre cada ticket.
 *
 * @param {string} action - 'create'|'update'|'delete'|'assign'|'close'|'reopen'|'comment_internal'
 *
 * Uso: router.put('/:id', authMiddleware, verifyTicketAction('update'), handler)
 */
const verifyTicketAction = (action) => {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ success: false, message: 'No autenticado' });
            }

            // ticket_id es null para 'create'
            const ticketId = req.params.id ? parseInt(req.params.id, 10) : null;

            if (ticketId && isNaN(ticketId)) {
                return res.status(400).json({ success: false, message: 'ID de ticket inválido' });
            }

            const { rows } = await db.query(
                'SELECT permitido, motivo FROM app.sp_verificar_accion_ticket($1, $2, $3)',
                [req.user.id, ticketId, action]
            );

            if (rows.length === 0) {
                return res.status(500).json({ success: false, message: 'Error al verificar acción' });
            }

            const { permitido, motivo } = rows[0];

            if (!permitido) {
                return res.status(403).json({ success: false, message: motivo });
            }

            // Adjuntar el ticketId verificado al request para usarlo en el controller
            req.ticketId = ticketId;
            next();

        } catch (error) {
            console.error('Error en verifyTicketAction:', error);
            return res.status(500).json({ success: false, message: 'Error al verificar acción sobre ticket' });
        }
    };
};


/**
 * menuGuard(menuName)
 * Verifica en DB si el usuario tiene acceso al módulo solicitado
 * antes de procesar la petición.
 * Evita bypasses por URL directa o copia de rutas.
 *
 * @param {string} menuName - nombre del menú en app.menus
 *
 * Uso: router.get('/roles', authMiddleware, menuGuard('roles'), handler)
 */
const menuGuard = (menuName) => {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ success: false, message: 'No autenticado' });
            }

            const { rows } = await db.query(
                'SELECT tiene_acceso, motivo, menu_titulo FROM app.sp_verificar_acceso_menu($1, $2)',
                [req.user.id, menuName]
            );

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
            }

            const { tiene_acceso, motivo } = rows[0];

            if (!tiene_acceso) {
                return res.status(403).json({ success: false, message: motivo });
            }

            next();
        } catch (error) {
            console.error('Error en menuGuard:', error);
            return res.status(500).json({ success: false, message: 'Error validando acceso al módulo' });
        }
    };
};


module.exports = { requirePermission, verifyTicketAction, menuGuard };
