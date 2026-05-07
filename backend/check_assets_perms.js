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
        const q = `
            SELECT m.nombre, m.ruta, rmp.can_view, r.nombre as rol
            FROM app.menus m
            LEFT JOIN app.role_menu_permissions rmp ON m.id = rmp.menu_id
            LEFT JOIN app.roles r ON rmp.role_id = r.id
            WHERE m.ruta = '/assets'
        `;
        const res = await client.query(q);
        console.table(res.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
