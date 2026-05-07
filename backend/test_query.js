require('dotenv').config();
const db = require('./src/config/db');
// Check admin user id and activo status
db.query("SELECT id, username, activo, rol_id FROM app.users WHERE username = 'admin';")
  .then(res => { 
    console.log(res.rows); 
    return db.query("SELECT * FROM app.sp_verificar_permiso(2, 'activos.ver');");
  })
  .then(res => { 
    console.log('admin SP result:', res.rows[0]);
    process.exit(0); 
  })
  .catch(err => { console.error(err.message); process.exit(1); });
