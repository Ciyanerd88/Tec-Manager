const { Client } = require('pg');
const client = new Client({
    user: 'postgres',
    password: '.Sera123',
    host: '10.168.100.59',
    port: 5432,
    database: 'manager'
});

client.connect()
    .then(() => client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'app'"))
    .then(res => {
        console.log(res.rows.map(r => r.table_name));
        return client.end();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
