
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    console.log('Renaming column rut_cuit to ruc...');
    await client.query('ALTER TABLE app.empresas RENAME COLUMN rut_cuit TO ruc;');
    
    console.log('Dropping column razon_social...');
    await client.query('ALTER TABLE app.empresas DROP COLUMN razon_social;');
    
    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
