require('dotenv').config();
const db = require('./src/config/db');

(async () => {
    try {
        console.log('Testing GET /api/admin/modules query...');
        const result = await db.query('SELECT * FROM app.asset_modules ORDER BY "order" ASC');
        console.log('Success! Rows:', result.rows.length);
        console.log('Sample row:', result.rows[0]);
    } catch (err) {
        console.error('ERROR in query:', err.message);
        console.error('Stack:', err.stack);
    } finally {
        process.exit();
    }
})();
