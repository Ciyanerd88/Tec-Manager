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

        console.log('Inserting Assets submodules...');
        await client.query(`
            INSERT INTO app.asset_modules (key, label, icon, route, parent_key, "order", is_active)
            VALUES
                ('inventario',    'Inventario',    'InboxOutlined',        '/assets/inventario',    'activos', 1, true),
                ('equipos',       'Equipos',       'DesktopOutlined',      '/assets/equipos',       'activos', 2, true),
                ('mantenimiento', 'Mantenimiento', 'ToolOutlined',         '/assets/mantenimiento', 'activos', 3, true),
                ('proveedores',   'Proveedores',   'ShopOutlined',         '/assets/proveedores',   'activos', 4, true)
            ON CONFLICT (key) DO NOTHING;
        `);
        console.log('Done.');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
