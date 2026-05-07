const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// ─── GET /api/persons ─────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { estado, departamento, search } = req.query;
        let query = `
            SELECT p.*,
                   u.id        AS user_id,
                   u.username  AS usuario_asociado,
                   e.nombre    AS empresa_nombre
            FROM app.persons p
            LEFT JOIN app.users u ON u.persona_id = p.id AND u.deleted_at IS NULL
            LEFT JOIN app.empresas e ON e.id = p.empresa_id
            WHERE 1=1
        `;
        const params = [];

        if (estado) {
            params.push(estado);
            query += ` AND p.estado = $${params.length}`;
        }
        if (departamento) {
            params.push(departamento);
            query += ` AND p.departamento = $${params.length}`;
        }
        if (search) {
            params.push(`%${search}%`);
            query += ` AND (
                p.primer_nombre ILIKE $${params.length} OR
                p.apellido      ILIKE $${params.length} OR
                p.numero_documento ILIKE $${params.length} OR
                p.email_personal   ILIKE $${params.length} OR
                p.email_trabajo    ILIKE $${params.length}
            )`;
        }

        query += ' ORDER BY p.created_at DESC';

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error obteniendo personas:', error);
        res.status(500).json({ success: false, message: 'Error al obtener personas' });
    }
});

// ─── GET /api/persons/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT p.*,
                   u.id       AS user_id,
                   u.username AS usuario_asociado,
                   u.activo   AS user_activo
            FROM app.persons p
            LEFT JOIN app.users u ON u.persona_id = p.id AND u.deleted_at IS NULL
            WHERE p.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Persona no encontrada' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error obteniendo persona:', error);
        res.status(500).json({ success: false, message: 'Error al obtener persona' });
    }
});

// ─── POST /api/persons ────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            empresa_id, primer_nombre, apellido, tipo_documento, numero_documento,
            fecha_nacimiento, genero, telefono_principal, telefono_secundario,
            email_personal, email_trabajo, direccion, ciudad, pais,
            cargo, departamento, fecha_ingreso, estado, notas
        } = req.body;

        if (!primer_nombre || !apellido || !empresa_id) {
            return res.status(400).json({ success: false, message: 'Primer nombre, apellido y empresa son requeridos' });
        }

        const docNumber = numero_documento || `ND-${Date.now()}`;
        const docType   = tipo_documento   || 'DNI';

        const exists = await db.query(
            'SELECT id FROM app.persons WHERE numero_documento = $1 AND empresa_id = $2', [docNumber, empresa_id]
        );
        if (exists.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya existe una persona con ese número de documento en esta empresa' });
        }

        const result = await db.query(`
            INSERT INTO app.persons (
                empresa_id, primer_nombre, apellido, tipo_documento, numero_documento,
                fecha_nacimiento, genero, telefono_principal, telefono_secundario,
                email_personal, email_trabajo, direccion, ciudad, pais,
                cargo, departamento, fecha_ingreso, estado, notas, usuario_creador_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            RETURNING *
        `, [
            empresa_id, primer_nombre, apellido, docType, docNumber,
            fecha_nacimiento || null, genero || null,
            telefono_principal || null, telefono_secundario || null,
            email_personal || null, email_trabajo || null,
            direccion || null, ciudad || null, pais || 'Argentina',
            cargo || null, departamento || null, fecha_ingreso || null,
            estado || 'activo', notas || null, req.user.id
        ]);

        res.status(201).json({ success: true, message: 'Persona creada exitosamente', data: result.rows[0] });
    } catch (error) {
        console.error('Error creando persona:', error);
        res.status(500).json({ success: false, message: 'Error al crear persona' });
    }
});

// ─── PUT /api/persons/:id ─────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const body = { ...req.body };
        delete body.id; delete body.usuario_creador_id; delete body.created_at; delete body.updated_at;

        const fields = Object.keys(body);
        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No hay datos para actualizar' });
        }

        const values = Object.values(body);
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        values.push(id);

        const result = await db.query(
            `UPDATE app.persons SET ${setClause} WHERE id = $${values.length} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Persona no encontrada' });
        }

        // Sincronizar empresa_id con el usuario si cambió
        if (body.empresa_id) {
            await db.query(
                'UPDATE app.users SET empresa_id = $1 WHERE persona_id = $2',
                [body.empresa_id, id]
            );
        }

        res.json({ success: true, message: 'Persona actualizada exitosamente', data: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando persona:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar persona' });
    }
});

// ─── DELETE /api/persons/:id (soft) ──────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const result = await db.query(
            'UPDATE app.persons SET estado = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            ['inactivo', req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Persona no encontrada' });
        }
        res.json({ success: true, message: 'Persona desactivada exitosamente' });
    } catch (error) {
        console.error('Error desactivando persona:', error);
        res.status(500).json({ success: false, message: 'Error al desactivar persona' });
    }
});

module.exports = router;
