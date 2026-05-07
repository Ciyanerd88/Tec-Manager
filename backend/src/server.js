require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./config/db');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socket = require('./socket');

const app = express();

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" } // Permite cargar imágenes/avatars externamente si se necesita
}));
const corsOptions = process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN, credentials: true }
    : {};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiting para prevenir ataques de fuerza bruta o DDoS básicos
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // Límite de 1000 peticiones por ventana por IP
    message: {
        success: false,
        message: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo después de 15 minutos.'
    },
    standardHeaders: true, // Retorna rate limit info en los headers `RateLimit-*`
    legacyHeaders: false, // Deshabilita los headers `X-RateLimit-*`
});

app.use('/api/', apiLimiter);

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads/avatars');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`${req.method} ${req.path}`, {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    });
    next();
});

// Routes
app.use('/api/auth', require('./routes_originales/auth'));
app.use('/api/persons', require('./routes_originales/persons'));
app.use('/api/users', require('./routes_originales/users'));
app.use('/api/roles', require('./routes_originales/roles'));
app.use('/api/projects', require('./routes_originales/projects'));
app.use('/api/tasks', require('./routes_originales/tasks')); // Legacy tasks
app.use('/api/tickets', require('./routes/tickets'));      // New tickets
app.use('/api/sucursales', require('./routes_originales/sucursales'));
app.use('/api/services', require('./routes_originales/services'));
app.use('/api/databases', require('./routes_originales/databases'));
app.use('/api/scripts', require('./routes_originales/scripts'));
app.use('/api/script-frecuencia-tipos', require('./routes_originales/script_frecuencia_tipos'));
app.use('/api/menus', require('./routes/menus'));
app.use('/api/infrastructure', require('./routes_originales/infrastructure'));
app.use('/api/servers', require('./routes_originales/servers'));
app.use('/api/ticket-config', require('./routes_originales/ticketConfig'));
app.use('/api/assets', require('./routes_originales/assets'));
app.use('/api/contratos', require('./routes_originales/contratos'));
app.use('/api/empresas', require('./routes_originales/empresas'));
app.use('/api/ubicaciones', require('./routes_originales/ubicaciones'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'API funcionando correctamente',
        timestamp: new Date().toISOString()
    });
});

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'API de Gestión de Tareas',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            persons: '/api/persons',
            users: '/api/users',
            roles: '/api/roles',
            projects: '/api/projects',
            tasks: '/api/tasks',
            health: '/api/health'
        }
    });
});

// 404 handler
app.use((req, res) => {
    logger.warn(`404 - Ruta no encontrada: ${req.method} ${req.path}`);
    res.status(404).json({
        success: false,
        message: 'Ruta no encontrada'
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.logError(err, {
        method: req.method,
        path: req.path,
        ip: req.ip,
        user: req.user?.username
    });
    res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 5000;

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason: String(reason) });
    process.exit(1);
});

// Test database connection before starting server
db.query('SELECT NOW()')
    .then(() => {
        logger.info('✓ Conectado a PostgreSQL');
        const server = http.createServer(app);
        socket.init(server);
        
        // Iniciar verificador de expiración
        require('./utils/expirationChecker');
        
        server.listen(PORT, () => {
            logger.info('Servidor iniciado', {
                port: PORT,
                environment: process.env.NODE_ENV || 'development',
                database: process.env.DB_NAME || 'task_management'
            });
            console.log(`\n========================================`);
            console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
            console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🗄️  Base de datos: ${process.env.DB_NAME || 'task_management'}`);
            console.log(`========================================\n`);
        });
    })
    .catch((err) => {
        logger.error('Error al conectar con la base de datos', {
            error: err.message,
            stack: err.stack
        });
        console.error('❌ Error al conectar con la base de datos:', err);
        process.exit(1);
    });

module.exports = app;
