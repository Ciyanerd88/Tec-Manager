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
        const r = await client.query("SELECT id, nombre, nivel FROM app.roles ORDER BY nivel DESC");
        console.table(r.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
