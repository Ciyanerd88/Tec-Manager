require('dotenv').config();
const { Client } = require('pg');

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
        await client.query('SET search_path TO app, public');

        console.log('--- ESTRUCTURA DE app.menus ---');
        const schema = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'app' AND table_name = 'menus'
            ORDER BY ordinal_position
        `);
        console.table(schema.rows);

        console.log('\n--- DATOS ACTUALES (Top 20) ---');
        const data = await client.query(`
            SELECT id, nombre, titulo, icono_css, ruta, parent_id, orden, activo 
            FROM app.menus 
            ORDER BY parent_id NULLS FIRST, orden ASC
            LIMIT 20
        `);
        console.table(data.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
