const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

router.use(authMiddleware);

// GET /api/projects
router.get('/', requirePermission('proyectos','ver'), async (req, res) => {
    try {
        const { estado } = req.query;
        let query = `
            SELECT p.*,
                   CONCAT(per.primer_nombre,' ',per.apellido) AS creador_nombre,
                   (SELECT COUNT(*) FROM app.tasks t WHERE t.project_id=p.id) AS total_tareas,
                   (SELECT COUNT(*) FROM app.tasks t WHERE t.project_id=p.id AND t.estado='completada') AS tareas_completadas
            FROM app.projects p
            LEFT JOIN app.users u ON u.id=p.usuario_creador_id
            LEFT JOIN app.persons per ON per.id=u.persona_id
            WHERE p.empresa_id = $1
        `;
        const params = [req.user.empresa_id];
        if (estado) { params.push(estado); query += ` AND p.estado=$${params.length}`; }
        query += ' ORDER BY p.created_at DESC';

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo proyectos:', e);
        res.status(500).json({ success: false, message: 'Error al obtener proyectos' });
    }
});

// GET /api/projects/stats/dashboard
router.get('/stats/dashboard', async (req, res) => {
    try {
        const statsResult = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM app.projects WHERE empresa_id = $1) AS "totalProyectos",
                (SELECT COUNT(*) FROM app.projects WHERE empresa_id = $1 AND estado='activo') AS "proyectosActivos",
                (SELECT COUNT(*) FROM app.projects WHERE empresa_id = $1 AND estado='completado') AS "proyectosCompletados",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1) AS "totalTareas",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='pendiente') AS "tareasPendientes",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='en_progreso') AS "tareasEnProgreso",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='en_espera') AS "tareasEnEspera",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='resuelto') AS "tareasResueltas",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='completada') AS "tareasCompletadas",
                (SELECT COUNT(*) FROM app.tasks WHERE empresa_id = $1 AND estado='cancelada') AS "tareasCanceladas"
        `, [req.user.empresa_id]);

        // Obtener tickets de los últimos 7 días para el gráfico
        const historyResult = await db.query(`
            SELECT 
                to_char(date_trunc('day', d), 'DD/MM') as name,
                (SELECT COUNT(*) FROM app.tasks t WHERE t.empresa_id = $1 AND date_trunc('day', t.created_at) = date_trunc('day', d)) as tickets,
                (SELECT COUNT(*) FROM app.tasks t WHERE t.empresa_id = $1 AND date_trunc('day', t.updated_at) = date_trunc('day', d) AND t.estado IN ('completada', 'resuelto')) as resolved
            FROM generate_series(
                current_date - interval '6 days',
                current_date,
                interval '1 day'
            ) d
            ORDER BY d ASC
        `, [req.user.empresa_id]);

        res.json({ 
            success: true, 
            data: {
                ...statsResult.rows[0],
                history: historyResult.rows
            }
        });
    } catch (e) {
        console.error('Error en stats dashboard:', e);
        res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
    }
});

// GET /api/projects/:id
router.get('/:id', requirePermission('proyectos','ver'), async (req, res) => {
    try {
        const result = await db.query(`
            SELECT p.*, CONCAT(per.primer_nombre,' ',per.apellido) AS creador_nombre
            FROM app.projects p
            LEFT JOIN app.users u ON u.id=p.usuario_creador_id
            LEFT JOIN app.persons per ON per.id=u.persona_id
            WHERE p.id=$1 AND p.empresa_id=$2
        `, [req.params.id, req.user.empresa_id]);
        if (!result.rows.length) return res.status(404).json({ success:false, message:'Proyecto no encontrado' });

        const members = await db.query(`
            SELECT pm.*, CONCAT(per.primer_nombre,' ',per.apellido) AS nombre, per.email_personal AS email, u.username
            FROM app.project_members pm
            JOIN app.users u ON u.id=pm.usuario_id
            LEFT JOIN app.persons per ON per.id=u.persona_id
            WHERE pm.project_id=$1
        `, [req.params.id]);

        res.json({ success: true, data: { ...result.rows[0], miembros: members.rows } });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener proyecto' });
    }
});

// POST /api/projects
router.post('/', requirePermission('proyectos','crear'), async (req, res) => {
    try {
        const { nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin, presupuesto } = req.body;
        if (!nombre) return res.status(400).json({ success:false, message:'El nombre es requerido' });

        const result = await db.query(`
            INSERT INTO app.projects (nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin, presupuesto, usuario_creador_id, empresa_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
        `, [nombre, descripcion, estado||'activo', prioridad||'media', fecha_inicio||null, fecha_fin||null, presupuesto||null, req.user.id, req.user.empresa_id]);

        // Add creator as member
        await db.query(
            'INSERT INTO app.project_members (project_id, usuario_id, rol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [result.rows[0].id, req.user.id, 'propietario']
        );

        res.status(201).json({ success: true, message: 'Proyecto creado exitosamente', data: result.rows[0] });
    } catch (e) {
        console.error('Error creando proyecto:', e);
        res.status(500).json({ success: false, message: 'Error al crear proyecto' });
    }
});

// PUT /api/projects/:id
router.put('/:id', requirePermission('proyectos','editar'), async (req, res) => {
    try {
        const { nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin, presupuesto } = req.body;
        const result = await db.query(`
            UPDATE app.projects SET
                nombre=COALESCE($1,nombre), descripcion=COALESCE($2,descripcion),
                estado=COALESCE($3,estado), prioridad=COALESCE($4,prioridad),
                fecha_inicio=COALESCE($5,fecha_inicio), fecha_fin=COALESCE($6,fecha_fin),
                presupuesto=COALESCE($7,presupuesto), updated_at=NOW()
            WHERE id=$8 AND empresa_id=$9 RETURNING *
        `, [nombre, descripcion, estado, prioridad, fecha_inicio, fecha_fin, presupuesto, req.params.id, req.user.empresa_id]);

        if (!result.rows.length) return res.status(404).json({ success:false, message:'Proyecto no encontrado' });
        res.json({ success: true, message: 'Proyecto actualizado', data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al actualizar proyecto' });
    }
});

// DELETE /api/projects/:id
router.delete('/:id', requirePermission('proyectos','eliminar'), async (req, res) => {
    try {
        const r = await db.query('DELETE FROM app.projects WHERE id=$1 AND empresa_id=$2 RETURNING *', [req.params.id, req.user.empresa_id]);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Proyecto no encontrado' });
        res.json({ success: true, message: 'Proyecto eliminado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar proyecto' });
    }
});

// POST /api/projects/:id/members
router.post('/:id/members', requirePermission('proyectos','agregar_miembros'), async (req, res) => {
    try {
        const { usuario_id, rol } = req.body;
        if (!usuario_id) return res.status(400).json({ success:false, message:'usuario_id requerido' });
        const result = await db.query(
            'INSERT INTO app.project_members (project_id, usuario_id, rol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',
            [req.params.id, usuario_id, rol||'colaborador']
        );
        res.status(201).json({ success: true, message: 'Miembro agregado', data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al agregar miembro' });
    }
});

module.exports = router;
