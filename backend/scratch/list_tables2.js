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
    const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app'`);
    console.log(res.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
