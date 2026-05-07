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
        const q1 = "SELECT * FROM app.rol_menus LIMIT 1";
        const r1 = await client.query(q1);
        console.log('--- rol_menus ---');
        console.table(r1.rows);

        const q2 = "SELECT * FROM app.role_module_permissions LIMIT 1";
        const r2 = await client.query(q2);
        console.log('--- role_module_permissions ---');
        console.table(r2.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
