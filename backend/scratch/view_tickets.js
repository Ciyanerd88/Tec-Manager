require('dotenv').config();
const db = require('../src/config/db');

async function main() {
    try {
        const { rows } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'v_tickets_completo'");
        console.log(rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
main();
