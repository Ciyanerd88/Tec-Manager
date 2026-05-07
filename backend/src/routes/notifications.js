const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { authMiddleware } = require('../middleware/auth');

// Obtener todas las notificaciones del usuario autenticado
router.get('/', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const notifications = await notificationService.getNotifications(req.user.id, limit);
        const unreadCount = await notificationService.getUnreadCount(req.user.id);
        
        res.json({
            success: true,
            data: notifications,
            unreadCount
        });
    } catch (err) {
        console.error('GET /notifications:', err);
        res.status(500).json({ success: false, message: 'Error al obtener notificaciones' });
    }
});

// Marcar una notificación como leída
router.put('/:id/read', authMiddleware, async (req, res) => {
    try {
        await notificationService.markAsRead(req.params.id, req.user.id);
        res.json({ success: true, message: 'Notificación marcada como leída' });
    } catch (err) {
        console.error('PUT /notifications/:id/read:', err);
        res.status(500).json({ success: false, message: 'Error al marcar notificación' });
    }
});

// Marcar todas como leídas
router.put('/read-all', authMiddleware, async (req, res) => {
    try {
        await notificationService.markAllAsRead(req.user.id);
        res.json({ success: true, message: 'Todas las notificaciones marcadas como leídas' });
    } catch (err) {
        console.error('PUT /notifications/read-all:', err);
        res.status(500).json({ success: false, message: 'Error al marcar notificaciones' });
    }
});

// Eliminar una notificación
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        await notificationService.deleteNotification(req.params.id, req.user.id);
        res.json({ success: true, message: 'Notificación eliminada' });
    } catch (err) {
        console.error('DELETE /notifications/:id:', err);
        res.status(500).json({ success: false, message: 'Error al eliminar notificación' });
    }
});

// Eliminar todas las notificaciones
router.delete('/', authMiddleware, async (req, res) => {
    try {
        await notificationService.deleteAllNotifications(req.user.id);
        res.json({ success: true, message: 'Todas las notificaciones eliminadas' });
    } catch (err) {
        console.error('DELETE /notifications:', err);
        res.status(500).json({ success: false, message: 'Error al eliminar notificaciones' });
    }
});

module.exports = router;
