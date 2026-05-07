// backend/src/middleware/auditMiddleware.js
// ============================================================
// MIDDLEWARE DE AUDITORÍA
// Registra acciones en audit.audit_logs sin bloquear la operación
// ============================================================

const db = require('../config/db');

// Campos sensibles que nunca se registran
const EXCLUDED_FIELDS = new Set([
    'password', 'password_hash', 'token', 'jwt',
    'current_password', 'new_password', 'secret',
]);

/**
 * Sanitiza un objeto eliminando campos sensibles.
 */
const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!EXCLUDED_FIELDS.has(key.toLowerCase())) {
            clean[key] = value;
        }
    }
    return clean;
};

/**
 * Extrae la IP real del request (X-Forwarded-For o socket).
 */
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || null;
};

/**
 * Escribe un registro de auditoría de forma asíncrona.
 * Si falla, solo loguea a consola — NUNCA falla la operación principal.
 */
const writeAuditLog = async ({ userId, action, entity, entityId, oldValue, newValue, req }) => {
    try {
        await db.query(
            `INSERT INTO audit.audit_logs
                (user_id, action, entity, entity_id, old_value, new_value, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                userId || null,
                action,
                entity || null,
                entityId || null,
                oldValue ? JSON.stringify(sanitize(oldValue)) : null,
                newValue ? JSON.stringify(sanitize(newValue)) : null,
                req ? getClientIp(req) : null,
                req ? (req.headers['user-agent'] || null) : null,
            ]
        );
    } catch (err) {
        console.error('[AUDIT] Error writing audit log:', err.message);
    }
};

/**
 * Middleware factory que registra la acción después de que la respuesta se envía.
 * 
 * Uso:
 *   router.post('/', auditAction('CREATE', 'module'), handler);
 *   router.put('/:id', auditAction('UPDATE', 'module'), handler);
 *
 * Para UPDATE: captura old_value antes de que el handler lo modifique.
 */
const auditAction = (action, entity, options = {}) => {
    const { getEntityId, getOldValue } = options;

    return async (req, res, next) => {
        // Para UPDATE/DELETE: capturar estado previo si se proporcionó función
        if (getOldValue && (action === 'UPDATE' || action === 'DELETE')) {
            try {
                req._auditOldValue = await getOldValue(req);
            } catch (err) {
                console.error('[AUDIT] Error fetching old value:', err.message);
            }
        }

        // Interceptar res.json para capturar el resultado
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // Registrar después de enviar respuesta (async, no bloquea)
            const entityId = getEntityId
                ? getEntityId(req, body)
                : (req.params?.id || body?.data?.id || null);

            writeAuditLog({
                userId: req.user?.id || null,
                action,
                entity,
                entityId: entityId ? parseInt(entityId) || null : null,
                oldValue: req._auditOldValue || null,
                newValue: body?.data ? sanitize(body.data) : null,
                req,
            });

            return originalJson(body);
        };

        next();
    };
};

/**
 * Log de eventos especiales (ACCESS_DENIED, LOGIN_FAIL, etc.)
 * Se llama directamente, no como middleware.
 */
const logSecurityEvent = (action, details = {}) => {
    writeAuditLog({
        userId: details.userId || null,
        action,
        entity: details.entity || 'auth',
        entityId: details.entityId || null,
        oldValue: null,
        newValue: details.data ? sanitize(details.data) : null,
        req: details.req || null,
    });
};

module.exports = { auditAction, writeAuditLog, logSecurityEvent, sanitize, getClientIp };
