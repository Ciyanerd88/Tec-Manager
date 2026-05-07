const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const uploadAttachments = require('../middleware/upload_attachments');
const { logTaskHistory } = require('../services/historyService');
const notificationService = require('../services/notificationService');

router.use(authMiddleware);

// GET /api/tasks
router.get('/', requirePermission('tickets.read.own'), async (req, res) => {
    try {
        const { project_id, estado, prioridad } = req.query;
        let query = `
            SELECT t.*,
                   pr.nombre AS proyecto_nombre,
                   CONCAT(p.primer_nombre,' ',p.apellido) AS creador_nombre,
                   CONCAT(pa.primer_nombre,' ',pa.apellido) AS asignado_nombre,
                   u2.username AS asignado_username,
                   u.avatar_url AS creador_avatar,
                   u2.avatar_url AS asignado_avatar,
                   t.activo,
                   tc.nombre AS categoria_nombre,
                   tsc.nombre AS subcategoria_nombre,
                   ti.nombre AS item_nombre
            FROM app.tasks t
            LEFT JOIN app.sucursales pr ON pr.id = t.project_id
            LEFT JOIN app.users u ON u.id = t.usuario_creador_id
            LEFT JOIN app.persons p ON p.id = u.persona_id
            LEFT JOIN app.users u2 ON u2.id = t.asignado_a
            LEFT JOIN app.persons pa ON pa.id = u2.persona_id
            LEFT JOIN app.ticket_categories tc ON tc.id = t.categoria_id
            LEFT JOIN app.ticket_subcategories tsc ON tsc.id = t.subcategoria_id
            LEFT JOIN app.ticket_items ti ON ti.id = t.item_id
            WHERE t.deleted_at IS NULL
        `;
        const params = [];
        
        // Restricción de visibilidad: 
        // A partir de Técnico (nivel >= 3) se pueden ver TODOS los tickets del sistema.
        // Nivel < 3 (Usuario normal, Consulta) solo ven tickets de su empresa y creados por ellos mismos.
        if (req.user.rol_nivel < 3) {
            params.push(req.user.empresa_id);
            query += ` AND t.empresa_id=$${params.length}`;
            params.push(req.user.id);
            query += ` AND t.usuario_creador_id=$${params.length}`;
        }

        if (project_id) { params.push(project_id); query += ` AND t.project_id=$${params.length}`; }
        if (estado)     { params.push(estado);      query += ` AND t.estado=$${params.length}`; }
        if (prioridad)  { params.push(prioridad);   query += ` AND t.prioridad=$${params.length}`; }
        query += ' ORDER BY t.created_at DESC';

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo tareas:', e);
        res.status(500).json({ success: false, message: 'Error al obtener tareas' });
    }
});

// GET /api/tasks/trash/list  →  listar papelera  (debe ir ANTES de /:id)
router.get('/trash/list', requirePermission('tickets.delete'), async (req, res) => {
    try {
        const query = req.user.rol_nivel >= 3
            ? `SELECT t.*, CONCAT(p.primer_nombre,' ',p.apellido) AS creador_nombre, u.username AS creador_username
               FROM app.tasks t
               LEFT JOIN app.users u ON u.id = t.usuario_creador_id
               LEFT JOIN app.persons p ON p.id = u.persona_id
               WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`
            : `SELECT t.*, CONCAT(p.primer_nombre,' ',p.apellido) AS creador_nombre, u.username AS creador_username
               FROM app.tasks t
               LEFT JOIN app.users u ON u.id = t.usuario_creador_id
               LEFT JOIN app.persons p ON p.id = u.persona_id
               WHERE t.deleted_at IS NOT NULL AND t.empresa_id=$1 ORDER BY t.deleted_at DESC`;
        const params = req.user.rol_nivel >= 3 ? [] : [req.user.empresa_id];
        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener papelera' });
    }
});

// PUT /api/tasks/trash/:id/restore  →  restaurar desde papelera
router.put('/trash/:id/restore', requirePermission('tickets.delete'), async (req, res) => {
    try {
        let query, params;
        if (req.user.rol_nivel >= 3) {
            query = `UPDATE app.tasks SET deleted_at=NULL, updated_at=NOW() WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *`;
            params = [req.params.id];
        } else {
            query = `UPDATE app.tasks SET deleted_at=NULL, updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND deleted_at IS NOT NULL RETURNING *`;
            params = [req.params.id, req.user.empresa_id];
        }
        const r = await db.query(query, params);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Ticket no encontrado en papelera' });
        res.json({ success: true, message: 'Ticket restaurado' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al restaurar ticket' });
    }
});

// DELETE /api/tasks/trash/:id  →  eliminación permanente
router.delete('/trash/:id', requirePermission('tickets.delete'), async (req, res) => {
    try {
        let query, params;
        if (req.user.rol_nivel >= 3) {
            query = `DELETE FROM app.tasks WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *`;
            params = [req.params.id];
        } else {
            query = `DELETE FROM app.tasks WHERE id=$1 AND empresa_id=$2 AND deleted_at IS NOT NULL RETURNING *`;
            params = [req.params.id, req.user.empresa_id];
        }
        const r = await db.query(query, params);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Ticket no encontrado en papelera' });
        res.json({ success: true, message: 'Ticket eliminado permanentemente' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar permanentemente' });
    }
});

// GET /api/tasks/:id
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.*, pr.nombre AS proyecto_nombre,
                   CONCAT(p.primer_nombre,' ',p.apellido) AS creador_nombre,
                   t.activo,
                   tc.nombre AS categoria_nombre,
                   tsc.nombre AS subcategoria_nombre,
                   ti.nombre AS item_nombre
            FROM app.tasks t
            LEFT JOIN app.sucursales pr ON pr.id = t.project_id
            LEFT JOIN app.users u ON u.id = t.usuario_creador_id
            LEFT JOIN app.persons p ON p.id = u.persona_id
            LEFT JOIN app.ticket_categories tc ON tc.id = t.categoria_id
            LEFT JOIN app.ticket_subcategories tsc ON tsc.id = t.subcategoria_id
            LEFT JOIN app.ticket_items ti ON ti.id = t.item_id
            WHERE t.id=$1 AND t.empresa_id=$2
        `, [req.params.id, req.user.empresa_id]);
        if (!result.rows.length) return res.status(404).json({ success:false, message:'Tarea no encontrada' });
        
        const task = result.rows[0];
        
        // Security check for normal users
        if (req.user.rol_nivel <= 2 && task.usuario_creador_id !== req.user.id) {
            return res.status(403).json({ success:false, message:'No tienes permiso para ver este ticket' });
        }
        
        res.json({ success: true, data: task });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al obtener tarea' });
    }
});

// POST /api/tasks/upload - Subir archivos para un ticket
router.post('/upload', requirePermission('tickets.create'), uploadAttachments.array('files', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No se subieron archivos' });
        }

        const today = new Date().toISOString().split('T')[0];
        const files = req.files.map(file => ({
            uid: Math.random().toString(36).substring(7),
            name: file.originalname,
            status: 'done',
            url: `/uploads/attachments/${today}/${file.filename}`,
            size: file.size,
            type: file.mimetype
        }));

        res.json({ success: true, files });
    } catch (e) {
        console.error('Error en upload:', e);
        res.status(500).json({ success: false, message: 'Error al subir archivos' });
    }
});

// POST /api/tasks
router.post('/', requirePermission('tickets.create'), async (req, res) => {
    try {
        const { 
            titulo, descripcion, estado, prioridad, project_id, 
            fecha_inicio, fecha_vencimiento, tiempo_estimado, 
            asignado_a, usuario_creador_id, activo, 
            categoria_id, subcategoria_id, item_id,
            tipo_ticket, departamento, telefono, ip_equipo,
            adjuntos 
        } = req.body;
        if (!titulo) return res.status(400).json({ success:false, message:'El título es requerido' });

        const creadorFinal = (req.user.rol_nivel >= 3 && usuario_creador_id) ? usuario_creador_id : req.user.id;
        const finalIP = ip_equipo || req.ip || req.connection.remoteAddress;

        const result = await db.query(`
            INSERT INTO app.tasks (
                empresa_id, project_id, usuario_creador_id, titulo, descripcion,
                tipo_ticket, prioridad, categoria_id, subcategoria_id, item_id,
                fecha_vencimiento, ip_address
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
        `, [
            req.user.empresa_id, project_id || null, creadorFinal, titulo, descripcion,
            tipo_ticket || 'incidente', prioridad || 'media', categoria_id || null, subcategoria_id || null, item_id || null,
            fecha_vencimiento || null, finalIP
        ]);

        const newTask = result.rows[0];
        
        // Log history: Creación
        await logTaskHistory(newTask.id, req.user.id, 'creado', finalIP);

        // Notificar a técnicos
        const techsRes = await db.query(`
            SELECT u.id FROM app.users u
            JOIN app.roles r ON r.id = u.rol_id
            WHERE u.empresa_id = $1 AND r.nivel >= 3 AND u.activo = TRUE AND u.id != $2
        `, [req.user.empresa_id, req.user.id]);

        for (const tech of techsRes.rows) {
            await notificationService.createNotification(
                tech.id,
                newTask.id,
                `Nuevo ticket: ${titulo}`,
                'nuevo_ticket'
            );
        }

        res.status(201).json({ success: true, data: newTask });
    } catch (e) {
        console.error('Error creando tarea:', e);
        res.status(500).json({ success: false, message: 'Error al crear tarea: ' + e.message });
    }
});

// PUT /api/tasks/:id
router.put('/:id', requirePermission('tickets.update.own'), async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body;
        
        // Obtener estado anterior para el log
        const oldTaskRes = await db.query('SELECT estado, asignado_a, prioridad FROM app.tasks WHERE id = $1', [id]);
        const oldTask = oldTaskRes.rows[0];
        
        if (!oldTask) return res.status(404).json({ success:false, message:'No se encontró el ticket' });

        const fields = [];
        const values = [];
        let i = 1;
        
        // Add all valid fields from frontend to whitelist
        const validFields = [
            'titulo', 'descripcion', 'estado', 'prioridad', 'asignado_a', 
            'categoria_id', 'subcategoria_id', 'item_id', 'notas_estado',
            'project_id', 'tipo_ticket', 'departamento', 'telefono', 
            'ip_equipo', 'tiempo_estimado', 'activo', 'fecha_vencimiento', 'fecha_inicio'
        ];

        for (const [key, value] of Object.entries(body)) {
            // Note: Map estimacion_horas to tiempo_estimado if frontend didn't
            const dbKey = key === 'estimacion_horas' ? 'tiempo_estimado' : key;
            if (validFields.includes(dbKey) && value !== undefined) {
                fields.push(`${dbKey}=$${i++}`);
                // Treat empty string as null for certain fields if necessary, but direct assignment is usually fine
                values.push(value === '' ? null : value);
            }
        }
        
        fields.push(`updated_at=NOW()`);
        
        let updateQuery = `UPDATE app.tasks SET ${fields.join(', ')} WHERE id=$${i++}`;
        values.push(id);

        if (req.user.rol_nivel < 3) {
            updateQuery += ` AND empresa_id=$${i++}`;
            values.push(req.user.empresa_id);
        }
        
        updateQuery += ` RETURNING *`;

        const result = await db.query(updateQuery, values);

        const updatedTask = result.rows[0];

        // Log cambios significativos
        if (body.estado && body.estado !== oldTask.estado) {
            await logTaskHistory(id, req.user.id, 'estado_cambiado', req.ip, 'estado', oldTask.estado, body.estado);
        }
        if (body.asignado_a !== undefined && body.asignado_a !== oldTask.asignado_a) {
            await logTaskHistory(id, req.user.id, 'reasignado', req.ip, 'asignado_a', oldTask.asignado_a?.toString(), body.asignado_a?.toString());
        }
        if (body.prioridad && body.prioridad !== oldTask.prioridad) {
            await logTaskHistory(id, req.user.id, 'prioridad_cambiada', req.ip, 'prioridad', oldTask.prioridad, body.prioridad);
        }
        if (body.notas_estado) {
            await logTaskHistory(id, req.user.id, 'notas_actualizadas', req.ip, 'notas_estado', null, body.notas_estado);
        }

        // Si el estado cambió a resuelto/cerrado, notificar al creador
        if (body.estado && (body.estado === 'resuelto' || body.estado === 'cerrado') && body.estado !== oldTask.estado) {
            const taskRes = await db.query('SELECT usuario_creador_id FROM app.tasks WHERE id = $1', [id]);
            if (taskRes.rows[0] && taskRes.rows[0].usuario_creador_id !== req.user.id) {
                await notificationService.createNotification(
                    taskRes.rows[0].usuario_creador_id,
                    id,
                    `Tu ticket #${id} ha sido ${body.estado}.`,
                    'ticket_resuelto'
                );
            }
        }

        res.json({ success: true, data: updatedTask });
    } catch (e) {
        console.error('Error al actualizar tarea:', e);
        res.status(500).json({ success: false, message: 'Error al actualizar tarea: ' + e.message });
    }
});

// DELETE /api/tasks/:id  →  soft delete (mueve a papelera)
router.delete('/:id', requirePermission('tickets.delete'), async (req, res) => {
    try {
        let query, params;
        if (req.user.rol_nivel >= 3) {
            query = `UPDATE app.tasks SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`;
            params = [req.params.id];
        } else {
            query = `UPDATE app.tasks SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND deleted_at IS NULL RETURNING *`;
            params = [req.params.id, req.user.empresa_id];
        }
        const r = await db.query(query, params);
        if (!r.rows.length) return res.status(404).json({ success:false, message:'Tarea no encontrada' });
        res.json({ success: true, message: 'Ticket movido a la papelera' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al eliminar tarea' });
    }
});

// POST /api/tasks/:id/assign
router.post('/:id/assign', requirePermission('tickets.assign'), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ success:false, message:'user_id requerido' });
        await db.query(
            'UPDATE app.tasks SET asignado_a=$1, updated_at=NOW() WHERE id=$2',
            [user_id, taskId]
        );
        // Log history: Asignación
        await logTaskHistory(taskId, req.user.id, 'asignado', req.ip, 'asignado_a', null, user_id.toString());

        if (user_id !== req.user.id) {
            await notificationService.createNotification(
                user_id,
                taskId,
                `Se te ha asignado el ticket #${taskId}.`,
                'ticket_asignado'
            );
        }

        res.json({ success: true, message: 'Ticket asignado correctamente' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al asignar tarea' });
    }
});

// GET /api/tasks/:id/history
router.get('/:id/history', async (req, res) => {
    try {
        // Evento de creación desde app.tasks
        const creation = await db.query(`
            SELECT
                t.id                  AS id,
                t.id                  AS ticket_id,
                t.usuario_creador_id  AS usuario_id,
                'creado'              AS accion,
                NULL                  AS campo_modificado,
                NULL                  AS valor_anterior,
                NULL                  AS valor_nuevo,
                t.created_at,
                NULL                  AS ip_address,
                CONCAT(p.primer_nombre, ' ', p.apellido) AS usuario_nombre,
                u.username            AS usuario_username
            FROM app.tasks t
            LEFT JOIN app.users u   ON u.id = t.usuario_creador_id
            LEFT JOIN app.persons p ON p.id = u.persona_id
            WHERE t.id = $1
        `, [req.params.id]);

        // Eventos adicionales de app.task_history (puede no existir aún)
        let historyRows = [];
        try {
            const history = await db.query(`
                SELECT
                    th.id,
                    th.task_id        AS ticket_id,
                    th.usuario_id,
                    th.accion,
                    th.campo_modificado,
                    th.valor_anterior,
                    th.valor_nuevo,
                    th.created_at,
                    th.ip_address,
                    CONCAT(p.primer_nombre, ' ', p.apellido) AS usuario_nombre,
                    u.username        AS usuario_username
                FROM app.task_history th
                LEFT JOIN app.users u   ON u.id = th.usuario_id
                LEFT JOIN app.persons p ON p.id = u.persona_id
                WHERE th.task_id = $1
            `, [req.params.id]);
            historyRows = history.rows;
        } catch (_) {
            // tabla task_history no existe aún, ignorar
        }

        const allRows = [...creation.rows, ...historyRows]
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        res.json({ success: true, data: allRows });
    } catch (e) {
        console.error('Error obteniendo historial:', e);
        res.status(500).json({ success: false, message: 'Error al obtener historial' });
    }
});

// GET /api/tasks/:id/notes
router.get('/:id/notes', async (req, res) => {
    try {
        const taskId = req.params.id;
        // Técnicos+ ven todas las notas; usuarios normales solo las públicas
        const internFilter = req.user.rol_nivel >= 3 ? '' : 'AND n.es_interno = false';
        const result = await db.query(`
            SELECT n.*,
                   CONCAT(p.primer_nombre,' ',p.apellido) AS autor_nombre,
                   u.username AS autor_username,
                   u.avatar_url AS autor_avatar
            FROM app.task_notes n
            LEFT JOIN app.users u   ON u.id = n.autor_id
            LEFT JOIN app.persons p ON p.id = u.persona_id
            WHERE n.task_id = $1 ${internFilter}
            ORDER BY n.created_at ASC
        `, [taskId]);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('Error obteniendo notas:', e);
        res.status(500).json({ success: false, message: 'Error al obtener notas' });
    }
});

// POST /api/tasks/:id/notes
router.post('/:id/notes', requirePermission('tickets.update.own'), async (req, res) => {
    try {
        if (req.user.rol_nivel < 3) {
            return res.status(403).json({ success: false, message: 'Solo los técnicos pueden agregar notas' });
        }
        const taskId = req.params.id;
        const { contenido, es_interno } = req.body;
        if (!contenido || !contenido.trim()) {
            return res.status(400).json({ success: false, message: 'El contenido de la nota es requerido' });
        }
        const noteRes = await db.query(`
            INSERT INTO app.task_notes (task_id, autor_id, contenido, es_interno)
            VALUES ($1, $2, $3, $4) RETURNING *
        `, [taskId, req.user.id, contenido.trim(), !!es_interno]);

        const userRes = await db.query(`
            SELECT CONCAT(p.primer_nombre,' ',p.apellido) AS autor_nombre, u.username, u.avatar_url
            FROM app.users u
            LEFT JOIN app.persons p ON p.id = u.persona_id
            WHERE u.id = $1
        `, [req.user.id]);

        const note = {
            ...noteRes.rows[0],
            autor_nombre:    userRes.rows[0]?.autor_nombre,
            autor_username:  userRes.rows[0]?.username,
            autor_avatar:    userRes.rows[0]?.avatar_url,
        };

        await logTaskHistory(taskId, req.user.id, 'nota_agregada', req.ip, null, null, es_interno ? 'interna' : 'publica');

        // Notificar
        const taskRes = await db.query('SELECT usuario_creador_id, asignado_a FROM app.tasks WHERE id = $1', [taskId]);
        const task = taskRes.rows[0];
        if (task) {
            // Si el autor no es el asignado, notificar al asignado
            if (task.asignado_a && req.user.id !== task.asignado_a) {
                await notificationService.createNotification(
                    task.asignado_a,
                    taskId,
                    `Nueva nota en el ticket #${taskId}.`,
                    'nota_agregada'
                );
            }
            // Si no es interna y el autor no es el creador, notificar al creador
            if (!es_interno && req.user.id !== task.usuario_creador_id) {
                await notificationService.createNotification(
                    task.usuario_creador_id,
                    taskId,
                    `El técnico añadió una nota a tu ticket #${taskId}.`,
                    'nota_agregada'
                );
            }
        }

        res.status(201).json({ success: true, data: note });
    } catch (e) {
        console.error('Error agregando nota:', e);
        res.status(500).json({ success: false, message: 'Error al agregar nota' });
    }
});

module.exports = router;
