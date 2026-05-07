// backend/src/routes/modules.js
// ============================================================
// GET /api/modules — devuelve módulos filtrados por rol del JWT
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/modules — módulos que el usuario puede ver según su rol
router.get('/', async (req, res) => {
    try {
        const { rol_id, rol_nivel } = req.user;

        // SuperAdmin (nivel >= 5): ve todo
        if (rol_nivel >= 5) {
            const result = await db.query(
                `SELECT m.*, true AS can_view, true AS can_edit
                 FROM app.asset_modules m
                 WHERE m.is_active = true
                 ORDER BY m."order" ASC`
            );
            return res.json({ success: true, data: result.rows });
        }

        // Para otros roles: solo módulos con permiso can_view
        const result = await db.query(
            `SELECT m.*, rmp.can_view, rmp.can_edit
             FROM app.asset_modules m
             INNER JOIN app.role_module_permissions rmp
                 ON rmp.module_key = m.key AND rmp.role_id = $1
             WHERE m.is_active = true AND rmp.can_view = true
             ORDER BY m."order" ASC`,
            [rol_id]
        );

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo módulos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener módulos' });
    }
});

module.exports = router;
