require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

(async () => {
    try {
        await client.connect();
        console.log('Connected');

        // Ensure audit schema exists
        await client.query('CREATE SCHEMA IF NOT EXISTS audit');
        console.log('Schema audit OK');

        // Set search path
        await client.query('SET search_path TO app, public');

        // Read and execute migration
        const sql = fs.readFileSync('../basedatos/11_modules_and_audit.sql', 'utf8');
        await client.query(sql);
        console.log('Migration 11 executed OK');

        // Verify
        const r1 = await client.query('SELECT count(*) FROM app.asset_modules');
        console.log('asset_modules rows:', r1.rows[0].count);

        const r2 = await client.query('SELECT count(*) FROM app.role_module_permissions');
        console.log('role_module_permissions rows:', r2.rows[0].count);

        const r3 = await client.query('SELECT count(*) FROM audit.audit_logs');
        console.log('audit_logs rows:', r3.rows[0].count);

    } catch (err) {
        console.error('Migration error:', err.message);
    } finally {
        await client.end();
    }
})();
