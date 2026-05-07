require('dotenv').config();
const db = require('../src/config/db');

async function main() {
    try {
        const { rows } = await db.query('SELECT id, nombre, titulo, orden, parent_id FROM app.menus ORDER BY parent_id NULLS FIRST, orden ASC');
        console.table(rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
main();
