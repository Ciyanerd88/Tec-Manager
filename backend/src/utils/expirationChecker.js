const db = require('../config/db');
const notificationService = require('../services/notificationService');

const checkExpiringTickets = async () => {
    console.log('Ejecutando verificador de tickets por expirar...');
    try {
        // Tickets que vencen en las próximas 24 horas y no están cerrados
        // Y que no han sido notificados ya (podríamos agregar un flag en tickets o chequear si ya existe una notif reciente)
        // Por simplicidad, buscaremos los que vencen pronto.
        const res = await db.query(`
            SELECT id, titulo, asignado_a, creado_por, fecha_limite
            FROM app.tickets
            WHERE estado NOT IN ('cerrado', 'resuelto')
              AND fecha_limite IS NOT NULL
              AND fecha_limite > NOW()
              AND fecha_limite < NOW() + INTERVAL '24 hours'
              AND deleted_at IS NULL
        `);

        for (const ticket of res.rows) {
            const mensaje = `El ticket #${ticket.id} (${ticket.titulo}) vence en menos de 24 horas.`;
            
            // Notificar al técnico asignado
            if (ticket.asignado_a) {
                await notificationService.createNotification(
                    ticket.asignado_a,
                    ticket.id,
                    mensaje,
                    'expiracion_proxima'
                );
            }
            
            // Notificar al creador también
            await notificationService.createNotification(
                ticket.creador_por,
                ticket.id,
                mensaje,
                'expiracion_proxima'
            );
        }
        
        console.log(`Verificación completada. ${res.rows.length} tickets procesados.`);
    } catch (err) {
        console.error('Error en checkExpiringTickets:', err);
    }
};

// En un entorno real, usaría node-cron. Aquí lo podemos llamar cada hora.
setInterval(checkExpiringTickets, 60 * 60 * 1000); 

// Primera ejecución inmediata
checkExpiringTickets();

module.exports = { checkExpiringTickets };
