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

        console.log('--- TODOS LOS MENÚS (app.menus) ---');
        const allMenus = await client.query(`
            SELECT id, nombre, titulo, parent_id, orden, activo 
            FROM app.menus 
            ORDER BY parent_id NULLS FIRST, orden ASC
        `);
        console.table(allMenus.rows);

        console.log('\n--- DEFINICIÓN DE sp_get_menus_usuario ---');
        const proc = await client.query(`
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = 'sp_get_menus_usuario'
        `);
        if (proc.rows.length > 0) {
            console.log(proc.rows[0].pg_get_functiondef);
        } else {
            console.log('Procedimiento no encontrado.');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
