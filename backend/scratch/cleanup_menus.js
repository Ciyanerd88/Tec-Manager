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

        console.log('--- PASO 1: Menús en DB ---');
        const res = await client.query(`
            SELECT id, nombre, ruta, parent_id, activo, orden 
            FROM app.menus 
            ORDER BY parent_id NULLS FIRST, orden
        `);
        console.table(res.rows);

        console.log('\n--- PASO 2: Limpiando duplicados... ---');
        const delRes = await client.query(`
            DELETE FROM app.menus 
            WHERE nombre ILIKE 'equipos' 
            AND id NOT IN (SELECT MIN(id) FROM app.menus WHERE nombre ILIKE 'equipos')
        `);
        console.log(`Filas eliminadas: ${delRes.rowCount}`);

        const resAfter = await client.query(`
            SELECT id, nombre, ruta, parent_id, activo, orden 
            FROM app.menus 
            WHERE nombre ILIKE 'equipos'
        `);
        console.log('\n--- Estado de "equipos" tras limpieza ---');
        console.table(resAfter.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
