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
    const res = await client.query(`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'sp_get_menus_usuario'`);
    console.log(res.rows[0].pg_get_functiondef);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
