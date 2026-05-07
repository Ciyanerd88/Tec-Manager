// backend/src/middleware/adminRateLimit.js
// ============================================================
// RATE LIMITER para rutas /admin — máx 30 req/min por user_id
// ============================================================

const rateLimit = require('express-rate-limit');

const adminRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 30,
    keyGenerator: (req) => {
        // Usar user_id del JWT (ya resuelto por authMiddleware)
        return req.user?.id ? `admin_${req.user.id}` : req.ip;
    },
    message: {
        success: false,
        message: 'Demasiadas solicitudes de administración. Máximo 30 por minuto.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = adminRateLimiter;
