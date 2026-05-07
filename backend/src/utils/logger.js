const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Asegurar que el directorio de logs existe
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Formato personalizado para consola (colorido) y archivos (JSON)
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'tec-manager-backend' },
    transports: [
        // Log de errores en archivo rotativo
        new winston.transports.DailyRotateFile({
            filename: path.join(logDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            level: 'error',
        }),
        // Log combinado (todo) en archivo rotativo
        new winston.transports.DailyRotateFile({
            filename: path.join(logDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
        }),
    ],
});

// Si no estamos en producción, loguear a la consola con formato legible
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
    }));
}

/**
 * Método de utilidad para loguear errores con contexto adicional.
 * @param {Error} error - El objeto de error.
 * @param {Object} context - Metadatos adicionales (req, user, etc).
 */
logger.logError = (error, context = {}) => {
    logger.error(error.message, {
        stack: error.stack,
        ...context
    });
};

module.exports = logger;
