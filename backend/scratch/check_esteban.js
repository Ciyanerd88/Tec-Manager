const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  password: '.Sera123',
  host: '10.168.100.59',
  port: 5432,
  database: 'manager'
});

async function run() {
  await client.connect();
  try {
    const res = await client.query(`SELECT r.nivel as rol_nivel, r.nombre as rol_nombre FROM app.users u LEFT JOIN app.roles r ON r.id = u.rol_id WHERE u.username = 'Esteban' OR u.username = 'esteban'`);
    console.log("Esteban user:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
