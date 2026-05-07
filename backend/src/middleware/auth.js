// backend/src/middleware/auth.js
// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN
// Verifica JWT y re-valida estado del usuario en DB
// ============================================================

const jwt = require('jsonwebtoken');
const db  = require('../config/db');

/**
 * authMiddleware
 * 1. Valida el JWT (firma y expiración)
 * 2. Re-verifica en DB que el usuario sigue activo y no está bloqueado
 *    (el JWT puede ser válido pero el usuario pudo haber sido desactivado)
 */
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No se proporcionó token de autenticación'
            });
        }

        const token = authHeader.substring(7);

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: err.name === 'TokenExpiredError'
                    ? 'Sesión expirada. Por favor iniciá sesión nuevamente.'
                    : 'Token inválido'
            });
        }

        // Re-verificar estado actual en DB (no confiar ciegamente en el JWT)
        const { rows } = await db.query(`
            SELECT
                u.id,
                u.username,
                u.empresa_id,
                u.activo,
                u.bloqueado,
                u.bloqueado_hasta,
                u.deleted_at,
                r.id     AS rol_id,
                r.nombre AS rol_nombre,
                r.nivel  AS rol_nivel
            FROM app.users u
            JOIN app.roles r ON r.id = u.rol_id
            WHERE u.id = $1
        `, [decoded.id]);

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
        }

        const user = rows[0];

        if (user.deleted_at) {
            return res.status(401).json({ success: false, message: 'Cuenta eliminada' });
        }

        if (!user.activo) {
            return res.status(403).json({
                success: false,
                message: 'Tu cuenta está deshabilitada. Contactá al administrador.'
            });
        }

        if (user.bloqueado) {
            const hasta = user.bloqueado_hasta
                ? ` hasta ${new Date(user.bloqueado_hasta).toLocaleString('es-AR')}`
                : '';
            return res.status(403).json({
                success: false,
                message: `Tu cuenta está bloqueada${hasta}.`
            });
        }

        // Adjuntar info verificada al request (viene de DB, no del JWT)
        req.user = {
            id:         user.id,
            username:   user.username,
            empresa_id: user.empresa_id,
            rol_id:     user.rol_id,
            rol_nombre: user.rol_nombre,
            rol_nivel:  user.rol_nivel
        };

        // Actualizar último acceso de forma asíncrona (no bloquea el request)
        db.query(
            'UPDATE app.users SET ultimo_acceso = NOW() WHERE id = $1',
            [user.id]
        ).catch(err => console.error('Error actualizando ultimo_acceso:', err));

        next();

    } catch (error) {
        console.error('Error en authMiddleware:', error);
        return res.status(500).json({ success: false, message: 'Error en la autenticación' });
    }
};

/**
 * adminMiddleware
 * Verifica que el usuario tenga nivel de administrador (>= 4)
 */
const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.rol_nivel >= 4) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Se requieren permisos de administrador'
        });
    }
};

/**
 * superAdminMiddleware
 * Verifica que el usuario tenga nivel de superadministrador (>= 5) o rol 'superadmin'
 */
const superAdminMiddleware = (req, res, next) => {
    const isSuper = req.user && (req.user.rol_nivel >= 5 || req.user.rol_nombre === 'superadmin');
    if (isSuper) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Se requieren permisos de superadministrador'
        });
    }
};

module.exports = { authMiddleware, adminMiddleware, superAdminMiddleware };
