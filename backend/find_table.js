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
        const q = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'role_menu_permissions'";
        const res = await client.query(q);
        console.table(res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
