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

        console.log('--- USUARIO admin ---');
        const userRes = await client.query(`
            SELECT u.id, u.username, r.nombre as rol, r.nivel, u.rol_id, u.custom_navigation
            FROM app.users u 
            JOIN app.roles r ON r.id = u.rol_id 
            WHERE u.username = 'admin'
        `);
        console.table(userRes.rows);

        if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            console.log(`\n--- MENÚS PARA EL ROL ${user.rol} (ID: ${user.rol_id}) ---`);
            const rolMenus = await client.query(`
                SELECT m.id, m.titulo, m.activo
                FROM app.rol_menus rm
                JOIN app.menus m ON m.id = rm.menu_id
                WHERE rm.rol_id = $1
            `, [user.rol_id]);
            console.table(rolMenus.rows);
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
