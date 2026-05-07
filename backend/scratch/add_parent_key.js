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

        // Add parent_key column
        await client.query(`
            ALTER TABLE app.asset_modules
            ADD COLUMN IF NOT EXISTS parent_key VARCHAR(60) DEFAULT NULL
        `);
        console.log('Column parent_key added OK');

        // Verify
        const r = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'app' AND table_name = 'asset_modules'
            ORDER BY ordinal_position
        `);
        console.log('Columns:', r.rows.map(c => c.column_name).join(', '));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
})();
