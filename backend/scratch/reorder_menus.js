require('dotenv').config();
const db = require('../src/config/db');

async function main() {
    try {
        await db.query(`
            UPDATE app.menus SET orden = 1 WHERE id = 1; -- Dashboard
            UPDATE app.menus SET orden = 2 WHERE id = 2; -- Tickets
            UPDATE app.menus SET orden = 3 WHERE id = 8; -- Usuarios
            UPDATE app.menus SET orden = 4 WHERE id = 7; -- Personas
            UPDATE app.menus SET orden = 5 WHERE id = 21; -- Proyectos
            UPDATE app.menus SET orden = 6 WHERE id = 22; -- Tareas
            UPDATE app.menus SET orden = 7 WHERE id = 30; -- Activos
            UPDATE app.menus SET orden = 8 WHERE id = 9; -- Servicios
            UPDATE app.menus SET orden = 9 WHERE id = 10; -- Base de conocimiento
            UPDATE app.menus SET orden = 10 WHERE id = 25; -- Infraestructura
            UPDATE app.menus SET orden = 11 WHERE id = 11; -- Reportes
            UPDATE app.menus SET orden = 12 WHERE id = 16; -- Configuración
            UPDATE app.menus SET orden = 13 WHERE id = 17; -- Auditoría
            UPDATE app.menus SET orden = 14 WHERE id = 18; -- Notificaciones
            UPDATE app.menus SET orden = 15 WHERE id = 19; -- Mi Perfil
        `);
        console.log("Menús reordenados exitosamente.");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
main();
