const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/sucursales - Obtener todas las sucursales
router.get('/', authMiddleware, async (req, res) => {
    try {
        const query = `
            SELECT id, codigo, nombre 
            FROM app.sucursales 
            ORDER BY id ASC
        `;
        const result = await db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo sucursales:', e);
        res.status(500).json({ success: false, message: 'Error al obtener sucursales' });
    }
});

module.exports = router;
