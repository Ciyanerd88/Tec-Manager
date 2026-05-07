const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const checkAdmin = (req, res, next) => {
    if (req.user?.rol_nivel >= 4) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Administrador' });
};

// --- CATEGORIES ---
router.get('/categories', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM app.ticket_categories ORDER BY nombre ASC');
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener categorías' });
    }
});

router.post('/categories', checkAdmin, async (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    try {
        const result = await db.query('INSERT INTO app.ticket_categories (nombre) VALUES ($1) RETURNING *', [nombre]);
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al crear categoría' });
    }
});

router.put('/categories/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    try {
        const result = await db.query('UPDATE app.ticket_categories SET nombre = $1 WHERE id = $2 RETURNING *', [nombre, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar categoría' });
    }
});

router.delete('/categories/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM app.ticket_categories WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
        res.json({ success: true, message: 'Categoría eliminada' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar categoría. Verifique si tiene subcategorías asociadas.' });
    }
});

// --- SUBCATEGORIES ---
router.get('/subcategories', async (req, res) => {
    const { categoria_id } = req.query;
    try {
        let query = 'SELECT * FROM app.ticket_subcategories';
        const params = [];
        if (categoria_id) {
            query += ' WHERE categoria_id = $1';
            params.push(categoria_id);
        }
        query += ' ORDER BY nombre ASC';
        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener subcategorías' });
    }
});

router.post('/subcategories', checkAdmin, async (req, res) => {
    const { categoria_id, nombre } = req.body;
    if (!categoria_id || !nombre) return res.status(400).json({ success: false, message: 'categoria_id y nombre son requeridos' });
    try {
        const result = await db.query('INSERT INTO app.ticket_subcategories (categoria_id, nombre) VALUES ($1, $2) RETURNING *', [categoria_id, nombre]);
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al crear subcategoría' });
    }
});

router.put('/subcategories/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    try {
        const result = await db.query('UPDATE app.ticket_subcategories SET nombre = $1 WHERE id = $2 RETURNING *', [nombre, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Subcategoría no encontrada' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar subcategoría' });
    }
});

router.delete('/subcategories/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM app.ticket_subcategories WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Subcategoría no encontrada' });
        res.json({ success: true, message: 'Subcategoría eliminada' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar subcategoría. Verifique si tiene artículos asociados.' });
    }
});

// --- ITEMS ---
router.get('/items', async (req, res) => {
    const { subcategoria_id } = req.query;
    try {
        let query = 'SELECT * FROM app.ticket_items';
        const params = [];
        if (subcategoria_id) {
            query += ' WHERE subcategoria_id = $1';
            params.push(subcategoria_id);
        }
        query += ' ORDER BY nombre ASC';
        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener artículos' });
    }
});

router.post('/items', checkAdmin, async (req, res) => {
    const { subcategoria_id, nombre } = req.body;
    if (!subcategoria_id || !nombre) return res.status(400).json({ success: false, message: 'subcategoria_id y nombre son requeridos' });
    try {
        const result = await db.query('INSERT INTO app.ticket_items (subcategoria_id, nombre) VALUES ($1, $2) RETURNING *', [subcategoria_id, nombre]);
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al crear artículo' });
    }
});

router.put('/items/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    try {
        const result = await db.query('UPDATE app.ticket_items SET nombre = $1 WHERE id = $2 RETURNING *', [nombre, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar artículo' });
    }
});

router.delete('/items/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('DELETE FROM app.ticket_items WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
        res.json({ success: true, message: 'Artículo eliminado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar artículo' });
    }
});

module.exports = router;
