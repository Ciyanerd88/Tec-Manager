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

        console.log('--- RESULTADO sp_get_menus_usuario(2) ---');
        const res = await client.query('SELECT * FROM app.sp_get_menus_usuario(2)');
        console.table(res.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
