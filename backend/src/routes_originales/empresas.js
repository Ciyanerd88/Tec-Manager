const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Solo superadmin (nivel 5) puede crear/editar/eliminar
const checkSuperAdmin = (req, res, next) => {
    if (req.user?.rol_nivel >= 5) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Superadmin' });
};

// GET /api/empresas — accesible a cualquier usuario autenticado
router.get('/', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, nombre, ruc, dominio_email,
                    telefono, direccion, ciudad, pais, activo,
                    created_at, updated_at
             FROM app.empresas
             WHERE deleted_at IS NULL
             ORDER BY nombre ASC`
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo empresas:', e);
        res.status(500).json({ success: false, message: 'Error al obtener empresas' });
    }
});

// GET /api/empresas/:id
router.get('/:id', checkSuperAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, nombre, ruc, dominio_email,
                    telefono, direccion, ciudad, pais, activo,
                    created_at, updated_at
             FROM app.empresas
             WHERE id = $1 AND deleted_at IS NULL`,
            [req.params.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        console.error('Error obteniendo empresa:', e);
        res.status(500).json({ success: false, message: 'Error al obtener empresa' });
    }
});

// POST /api/empresas
router.post('/', checkSuperAdmin, async (req, res) => {
    try {
        const {
            nombre, ruc,
            dominio_email, telefono, direccion, ciudad,
            pais = 'Paraguay', activo = true
        } = req.body;

        if (!nombre?.trim()) {
            return res.status(400).json({ success: false, message: 'El nombre es requerido' });
        }

        const result = await db.query(
            `INSERT INTO app.empresas
                (nombre, ruc, dominio_email, telefono, direccion, ciudad, pais, activo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                nombre.trim(),
                ruc?.trim()           || null,
                dominio_email?.trim() || null,
                telefono?.trim()      || null,
                direccion?.trim()     || null,
                ciudad?.trim()        || null,
                pais,
                activo
            ]
        );
        res.status(201).json({ success: true, message: 'Empresa creada exitosamente', data: result.rows[0] });
    } catch (e) {
        console.error('Error creando empresa:', e);
        if (e.code === '23505') {
            return res.status(400).json({ success: false, message: 'El RUC ya está registrado en otra empresa' });
        }
        res.status(500).json({ success: false, message: 'Error al crear empresa' });
    }
});

// PUT /api/empresas/:id
router.put('/:id', checkSuperAdmin, async (req, res) => {
    try {
        const {
            nombre, ruc,
            dominio_email, telefono, direccion, ciudad,
            pais, activo
        } = req.body;

        const result = await db.query(
            `UPDATE app.empresas
             SET nombre        = COALESCE($1, nombre),
                 ruc           = $2,
                 dominio_email = $3,
                 telefono      = $4,
                 direccion     = $5,
                 ciudad        = $6,
                 pais          = COALESCE($7, pais),
                 activo        = COALESCE($8, activo),
                 updated_at    = NOW()
             WHERE id = $9 AND deleted_at IS NULL
             RETURNING *`,
            [
                nombre?.trim()        || null,
                ruc?.trim()           ?? null,
                dominio_email?.trim() ?? null,
                telefono?.trim()      ?? null,
                direccion?.trim()     ?? null,
                ciudad?.trim()        ?? null,
                pais                  || null,
                activo                ?? null,
                req.params.id
            ]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
        }
        res.json({ success: true, message: 'Empresa actualizada', data: result.rows[0] });
    } catch (e) {
        console.error('Error actualizando empresa:', e);
        if (e.code === '23505') {
            return res.status(400).json({ success: false, message: 'El RUC ya está registrado en otra empresa' });
        }
        res.status(500).json({ success: false, message: 'Error al actualizar empresa' });
    }
});

// DELETE /api/empresas/:id — soft delete
router.delete('/:id', checkSuperAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE app.empresas SET deleted_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL
             RETURNING id`,
            [req.params.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
        }
        res.json({ success: true, message: 'Empresa eliminada' });
    } catch (e) {
        console.error('Error eliminando empresa:', e);
        res.status(500).json({ success: false, message: 'Error al eliminar empresa' });
    }
});

module.exports = router;
