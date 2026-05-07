const db = require('../config/db');

/**
 * Registra un evento en el historial de un ticket
 * @param {number} ticketId - ID del ticket
 * @param {number} usuarioId - ID del usuario que realiza la acción
 * @param {string} accion - Nombre de la acción (ej: 'creado', 'modificado', 'resuelto', 'asignado')
 * @param {string} ipAddress - Dirección IP del cliente
 * @param {string} [campo] - Nombre del campo modificado (opcional)
 * @param {string} [anterior] - Valor anterior (opcional)
 * @param {string} [nuevo] - Valor nuevo (opcional)
 */
async function logHistory(ticketId, usuarioId, accion, ipAddress, campo = null, anterior = null, nuevo = null) {
    try {
        await db.query(`
            INSERT INTO app.ticket_history
                (ticket_id, usuario_id, accion, ip_address, campo_modificado, valor_anterior, valor_nuevo)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [ticketId, usuarioId, accion, ipAddress, campo, anterior, nuevo]);
    } catch (error) {
        console.error('Error logging ticket history:', error);
        // No lanzamos el error para no bloquear la operación principal
    }
}

async function logTaskHistory(taskId, usuarioId, accion, ipAddress, campo = null, anterior = null, nuevo = null) {
    try {
        await db.query(`
            INSERT INTO app.task_history
                (task_id, usuario_id, accion, ip_address, campo_modificado, valor_anterior, valor_nuevo)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [taskId, usuarioId, accion, ipAddress, campo, anterior, nuevo]);
    } catch (error) {
        console.error('Error logging task history:', error);
    }
}

module.exports = {
    logHistory,
    logTaskHistory
};
