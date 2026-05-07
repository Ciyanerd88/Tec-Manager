// backend/src/config/db.js
// ============================================================
// CONFIGURACIÓN DE BASE DE DATOS
// Pool de conexiones PostgreSQL con schema app por defecto
// ============================================================

const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'tec_manager',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max:      parseInt(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false
});

// Forzar search_path y timezone en cada nueva conexión
pool.on('connect', (client) => {
    client.query("SET search_path TO app, public; SET timezone TO 'America/Asuncion'");
});

pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err);
});

// Verificar conexión al iniciar
pool.connect()
    .then(client => {
        console.log('✅ Conexión a PostgreSQL exitosa');
        client.release();
    })
    .catch(err => {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
        process.exit(1);
    });

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool
};
