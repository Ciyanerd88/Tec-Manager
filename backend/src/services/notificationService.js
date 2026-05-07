const db = require('../config/db');
const socket = require('../socket');

class NotificationService {
    async createNotification(usuario_id_destino, ticket_id, mensaje, tipo_alerta) {
        try {
            const result = await db.query(
                `INSERT INTO app.notificaciones (usuario_id_destino, ticket_id, mensaje, tipo_alerta)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [usuario_id_destino, ticket_id, mensaje, tipo_alerta]
            );
            
            const notification = result.rows[0];

            // Emit via Socket.io
            try {
                const io = socket.getIO();
                io.to(`user_${usuario_id_destino}`).emit('nueva_notificacion', notification);
            } catch (err) {
                console.error('Socket.io emit error (puede que no esté inicializado o cliente offline):', err.message);
            }

            return notification;
        } catch (error) {
            console.error('Error creating notification:', error);
            throw error;
        }
    }

    async getUnreadCount(usuario_id) {
        const result = await db.query(
            `SELECT COUNT(*) FROM app.notificaciones WHERE usuario_id_destino = $1 AND leido = false`,
            [usuario_id]
        );
        return parseInt(result.rows[0].count);
    }

    async getNotifications(usuario_id, limit = 20) {
        const result = await db.query(
            `SELECT * FROM app.notificaciones WHERE usuario_id_destino = $1 ORDER BY created_at DESC LIMIT $2`,
            [usuario_id, limit]
        );
        return result.rows;
    }

    async markAsRead(notification_id, usuario_id) {
        await db.query(
            `UPDATE app.notificaciones SET leido = true WHERE id = $1 AND usuario_id_destino = $2`,
            [notification_id, usuario_id]
        );
    }
    
    async markAllAsRead(usuario_id) {
        await db.query(
            `UPDATE app.notificaciones SET leido = true WHERE usuario_id_destino = $1`,
            [usuario_id]
        );
    }

    async deleteNotification(notification_id, usuario_id) {
        await db.query(
            `DELETE FROM app.notificaciones WHERE id = $1 AND usuario_id_destino = $2`,
            [notification_id, usuario_id]
        );
    }

    async deleteAllNotifications(usuario_id) {
        await db.query(
            `DELETE FROM app.notificaciones WHERE usuario_id_destino = $1`,
            [usuario_id]
        );
    }
}

module.exports = new NotificationService();
