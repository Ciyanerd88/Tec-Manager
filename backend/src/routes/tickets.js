// backend/src/routes/tickets.js
// ============================================================
// RUTAS DE TICKETS
// Toda acción pasa por verifyTicketAction (SP en DB)
// ============================================================

const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const { authMiddleware }                        = require('../middleware/auth');
const { verifyTicketAction, requirePermission } = require('../middleware/permissions');
const { uploadAdjunto, MIME_PERMITIDOS }        = require('../middleware/upload_attachments');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const notificationService = require('../services/notificationService');
const { logHistory } = require('../services/historyService');

const UPLOADS_BASE = process.env.UPLOADS_PATH || path.join(__dirname, '../../../uploads');


// ============================================================
// GET /api/tickets — listar tickets
// ============================================================
router.get('/', authMiddleware, requirePermission('tickets.read.own'), async (req, res) => {
    try {
        const { estado, prioridad, asignado_a, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Nivel < 3 (usuario/consulta): solo ve sus propios tickets
        const soloSuyos = req.user.rol_nivel < 3;

        const params  = [];
        // Note: deleted_at is already filtered by the view v_tickets_completo
        const filtros = [];
        let   idx     = 1;

        if (soloSuyos) {
            filtros.push(`t.empresa_id = $${idx++}`);
            params.push(req.user.empresa_id);
            filtros.push(`t.creado_por = $${idx++}`);
            params.push(req.user.id);
        }
        if (estado) {
            filtros.push(`t.estado = $${idx++}::ticket_estado_val`);
            params.push(estado);
        }
        if (prioridad) {
            filtros.push(`t.prioridad = $${idx++}::ticket_prioridad_val`);
            params.push(prioridad);
        }
        if (asignado_a && !soloSuyos) {
            filtros.push(`t.asignado_a = $${idx++}`);
            params.push(parseInt(asignado_a));
        }

        const where = filtros.join(' AND ');

        const [dataRes, countRes] = await Promise.all([
            db.query(`
                SELECT * FROM app.v_tickets_completo t
                WHERE ${where}
                ORDER BY t.created_at DESC
                LIMIT $${idx} OFFSET $${idx + 1}
            `, [...params, parseInt(limit), offset]),
            db.query(`
                SELECT COUNT(*) FROM app.v_tickets_completo t WHERE ${where}
            `, params)
        ]);

        res.json({
            success: true,
            data:  dataRes.rows,
            total: parseInt(countRes.rows[0].count),
            page:  parseInt(page),
            pages: Math.ceil(parseInt(countRes.rows[0].count) / parseInt(limit))
        });
    } catch (err) {
        console.error('GET /tickets:', err);
        res.status(500).json({ success: false, message: 'Error al obtener tickets' });
    }
});


// ============================================================
// GET /api/tickets/:id — detalle de ticket
// ============================================================
router.get('/:id', authMiddleware, verifyTicketAction('read'), async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT * FROM app.v_tickets_completo WHERE id = $1',
            [req.ticketId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        }

        // Comentarios: usuario solo ve los no-internos
        const esStaff = req.user.rol_nivel >= 3;
        const comentariosRes = await db.query(`
            SELECT
                tc.id, tc.contenido, tc.es_interno, tc.created_at,
                p.primer_nombre || ' ' || p.apellido AS autor_nombre,
                u.avatar_url AS autor_avatar
            FROM app.ticket_comentarios tc
            JOIN app.users u   ON u.id  = tc.autor_id
            JOIN app.persons p ON p.id  = u.persona_id
            WHERE tc.ticket_id = $1
              AND tc.deleted_at IS NULL
              ${!esStaff ? 'AND tc.es_interno = FALSE' : ''}
            ORDER BY tc.created_at ASC
        `, [req.ticketId]);

        // Adjuntos: filtrar según es_publico y rol
        const adjuntosRes = await db.query(`
            SELECT
                ta.id, ta.nombre_original, ta.tipo,
                ta.mime_type, ta.tamano_bytes, ta.es_publico, ta.created_at
            FROM app.ticket_adjuntos ta
            WHERE ta.ticket_id = $1
              ${!esStaff ? 'AND ta.es_publico = TRUE' : ''}
            ORDER BY ta.created_at ASC
        `, [req.ticketId]);

        // Historial — visible para todos
        const histRes = await db.query(`
            SELECT th.accion, th.campo_modificado, th.valor_anterior, th.valor_nuevo,
                   th.created_at, th.ip_address,
                   p.primer_nombre || ' ' || p.apellido AS usuario_nombre
            FROM app.ticket_history th
            LEFT JOIN app.users u   ON u.id  = th.usuario_id
            LEFT JOIN app.persons p ON p.id  = u.persona_id
            WHERE th.ticket_id = $1
            ORDER BY th.created_at ASC
        `, [req.ticketId]);
        const historial = histRes.rows;

        res.json({
            success: true,
            data: {
                ...rows[0],
                comentarios: comentariosRes.rows,
                adjuntos:    adjuntosRes.rows,
                historial
            }
        });
    } catch (err) {
        console.error('GET /tickets/:id:', err);
        res.status(500).json({ success: false, message: 'Error al obtener el ticket' });
    }
});


// ============================================================
// POST /api/tickets — crear ticket
// ============================================================
router.post('/', authMiddleware, verifyTicketAction('create'), async (req, res) => {
    try {
        const { titulo, descripcion, prioridad = 'media', categoria_id, fecha_limite } = req.body;

        if (!titulo?.trim() || !descripcion?.trim()) {
            return res.status(400).json({ success: false, message: 'Título y descripción son requeridos' });
        }

        const { rows } = await db.query(`
            INSERT INTO app.tickets
                (empresa_id, titulo, descripcion, prioridad, categoria_id, fecha_limite, creado_por)
            VALUES ($1, $2, $3, $4::ticket_prioridad_val, $5, $6, $7)
            RETURNING *
        `, [
            req.user.empresa_id,
            titulo.trim(),
            descripcion.trim(),
            prioridad,
            categoria_id || null,
            fecha_limite  || null,
            req.user.id
        ]);

        await logHistory(rows[0].id, req.user.id, 'creado', req.ip);

        // Notificar a todos los técnicos/superiores de la empresa
        const techsRes = await db.query(`
            SELECT u.id FROM app.users u
            JOIN app.roles r ON r.id = u.rol_id
            WHERE u.empresa_id = $1 AND r.nivel >= 3 AND u.activo = TRUE AND u.id != $2
        `, [req.user.empresa_id, req.user.id]);

        for (const tech of techsRes.rows) {
            await notificationService.createNotification(
                tech.id,
                rows[0].id,
                `Nuevo ticket creado: ${titulo.trim()}`,
                'nuevo_ticket'
            );
        }

        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('POST /tickets:', err);
        res.status(500).json({ success: false, message: 'Error al crear el ticket' });
    }
});


// ============================================================
// PUT /api/tickets/:id — editar ticket
// SP en DB decide si puede o no (usuario solo edita los suyos)
// ============================================================
router.put('/:id', authMiddleware, verifyTicketAction('update'), async (req, res) => {
    try {
        const { titulo, descripcion, prioridad, categoria_id, fecha_limite } = req.body;

        // Campos que un Usuario (nivel 2) puede editar
        const camposUsuario = { titulo, descripcion };
        // Campos extra que solo Técnico+ puede editar
        const camposStaff  = req.user.rol_nivel >= 3
            ? { prioridad, categoria_id, fecha_limite }
            : {};

        const campos = { ...camposUsuario, ...camposStaff };
        const sets   = [];
        const params = [];
        let idx = 1;

        for (const [key, val] of Object.entries(campos)) {
            if (val !== undefined) {
                sets.push(`${key} = $${idx++}`);
                params.push(val);
            }
        }

        if (sets.length === 0) {
            return res.status(400).json({ success: false, message: 'No hay campos para actualizar' });
        }

        params.push(req.ticketId);
        const { rows } = await db.query(
            `UPDATE app.tickets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );

        // Registrar cada campo modificado en el historial
        for (const [key, val] of Object.entries(campos)) {
            if (val !== undefined) {
                await logHistory(req.ticketId, req.user.id, 'modificado', req.ip, key, null, String(val));
            }
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT /tickets/:id:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar el ticket' });
    }
});


// ============================================================
// PUT /api/tickets/:id/asignar — asignar técnico
// ============================================================
router.put('/:id/asignar', authMiddleware, verifyTicketAction('assign'), async (req, res) => {
    try {
        const { tecnico_id } = req.body;
        if (!tecnico_id) {
            return res.status(400).json({ success: false, message: 'tecnico_id es requerido' });
        }

        // Verificar que el técnico pertenece a la misma empresa y tiene nivel >= 3
        const tecRes = await db.query(`
            SELECT u.id FROM app.users u
            JOIN app.roles r ON r.id = u.rol_id
            WHERE u.id = $1 AND u.empresa_id = $2 AND r.nivel >= 3 AND u.activo = TRUE
        `, [tecnico_id, req.user.empresa_id]);

        if (tecRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Técnico no válido para esta empresa' });
        }

        const { rows } = await db.query(`
            UPDATE app.tickets
            SET asignado_a = $1, estado = 'asignado'::ticket_estado_val
            WHERE id = $2
            RETURNING *
        `, [tecnico_id, req.ticketId]);

        await logHistory(req.ticketId, req.user.id, 'asignado', req.ip, 'asignado_a', null, String(tecnico_id));

        // Notificar al técnico asignado
        if (tecnico_id !== req.user.id) {
            await notificationService.createNotification(
                tecnico_id,
                req.ticketId,
                `Se te ha asignado el ticket #${req.ticketId}.`,
                'ticket_asignado'
            );
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT /tickets/:id/asignar:', err);
        res.status(500).json({ success: false, message: 'Error al asignar el ticket' });
    }
});


// ============================================================
// PUT /api/tickets/:id/cerrar
// ============================================================
router.put('/:id/cerrar', authMiddleware, verifyTicketAction('close'), async (req, res) => {
    try {
        const { rows } = await db.query(`
            UPDATE app.tickets
            SET estado = 'cerrado'::ticket_estado_val,
                cerrado_en  = NOW(),
                resuelto_en = COALESCE(resuelto_en, NOW())
            WHERE id = $1
            RETURNING *
        `, [req.ticketId]);

        await logHistory(req.ticketId, req.user.id, 'cerrado', req.ip, 'estado', null, 'cerrado');

        // Obtener al creador para notificarle
        const ticketRes = await db.query('SELECT creado_por FROM app.tickets WHERE id = $1', [req.ticketId]);
        if (ticketRes.rows[0] && ticketRes.rows[0].creado_por !== req.user.id) {
            await notificationService.createNotification(
                ticketRes.rows[0].creado_por,
                req.ticketId,
                `Tu ticket #${req.ticketId} ha sido resuelto/cerrado.`,
                'ticket_resuelto'
            );
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT /tickets/:id/cerrar:', err);
        res.status(500).json({ success: false, message: 'Error al cerrar el ticket' });
    }
});


// ============================================================
// PUT /api/tickets/:id/reabrir
// ============================================================
router.put('/:id/reabrir', authMiddleware, verifyTicketAction('reopen'), async (req, res) => {
    try {
        const { rows } = await db.query(`
            UPDATE app.tickets
            SET estado = 'en_progreso'::ticket_estado_val,
                cerrado_en  = NULL,
                resuelto_en = NULL
            WHERE id = $1
            RETURNING *
        `, [req.ticketId]);

        await logHistory(req.ticketId, req.user.id, 'reabierto', req.ip, 'estado', 'cerrado', 'en_progreso');

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT /tickets/:id/reabrir:', err);
        res.status(500).json({ success: false, message: 'Error al reabrir el ticket' });
    }
});


// ============================================================
// DELETE /api/tickets/:id — eliminar (soft delete)
// ============================================================
router.delete('/:id', authMiddleware, verifyTicketAction('delete'), async (req, res) => {
    try {
        await db.query(
            'UPDATE app.tickets SET deleted_at = NOW() WHERE id = $1',
            [req.ticketId]
        );
        res.json({ success: true, message: 'Ticket eliminado correctamente' });
    } catch (err) {
        console.error('DELETE /tickets/:id:', err);
        res.status(500).json({ success: false, message: 'Error al eliminar el ticket' });
    }
});


// ============================================================
// POST /api/tickets/:id/comentarios — agregar comentario
// ============================================================
router.post('/:id/comentarios', authMiddleware, verifyTicketAction('update'), async (req, res) => {
    try {
        const { contenido, es_interno = false } = req.body;

        if (!contenido?.trim()) {
            return res.status(400).json({ success: false, message: 'El contenido es requerido' });
        }

        // Solo staff puede crear comentarios internos
        const esInterno = Boolean(es_interno) && req.user.rol_nivel >= 3;

        const { rows } = await db.query(`
            INSERT INTO app.ticket_comentarios (ticket_id, autor_id, contenido, es_interno)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [req.ticketId, req.user.id, contenido.trim(), esInterno]);

        // Obtener datos del ticket para saber a quién notificar
        const ticketRes = await db.query('SELECT creado_por, asignado_a FROM app.tickets WHERE id = $1', [req.ticketId]);
        const ticket = ticketRes.rows[0];

        if (ticket) {
            // Si el creador del comentario no es el técnico asignado, notificar al técnico (si hay uno)
            if (ticket.asignado_a && req.user.id !== ticket.asignado_a) {
                await notificationService.createNotification(
                    ticket.asignado_a,
                    req.ticketId,
                    `Nueva nota en el ticket #${req.ticketId}.`,
                    'nota_agregada'
                );
            }
            
            // Si el comentario NO es interno y el creador no es el solicitante, notificar al solicitante
            if (!esInterno && req.user.id !== ticket.creado_por) {
                await notificationService.createNotification(
                    ticket.creado_por,
                    req.ticketId,
                    `El técnico añadió una nota a tu ticket #${req.ticketId}.`,
                    'nota_agregada'
                );
            }
        }

        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('POST /tickets/:id/comentarios:', err);
        res.status(500).json({ success: false, message: 'Error al agregar comentario' });
    }
});


// ============================================================
// POST /api/tickets/:id/adjuntos — subir archivos
// ============================================================
router.post('/:id/adjuntos',
    authMiddleware,
    verifyTicketAction('update'),
    uploadAdjunto,
    async (req, res) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, message: 'No se recibieron archivos' });
            }

            const adjuntosCreados = [];
            const { createHash } = require('crypto');

            for (const file of req.files) {
                const mime_info = MIME_PERMITIDOS[file.mimetype] || { tipo: 'otro' };

                // Hash SHA-256 para integridad
                const fileBuffer = fs.readFileSync(file.path);
                const hash = createHash('sha256').update(fileBuffer).digest('hex');

                // Ruta relativa (sin la base de uploads)
                const rutaRelativa = path.relative(UPLOADS_BASE, file.path).replace(/\\/g, '/');

                const { rows } = await db.query(`
                    INSERT INTO app.ticket_adjuntos
                        (ticket_id, nombre_original, ruta_almacenada, tipo, mime_type,
                         tamano_bytes, hash_sha256, subido_por, es_publico)
                    VALUES ($1, $2, $3, $4::adjunto_tipo, $5, $6, $7, $8, $9)
                    RETURNING id, nombre_original, tipo, tamano_bytes, created_at
                `, [
                    req.ticketId,
                    file.originalname,
                    rutaRelativa,
                    mime_info.tipo,
                    file.mimetype,
                    file.size,
                    hash,
                    req.user.id,
                    req.body.es_publico === 'true'
                ]);

                adjuntosCreados.push(rows[0]);
            }

            res.status(201).json({ success: true, data: adjuntosCreados });
        } catch (err) {
            console.error('POST /tickets/:id/adjuntos:', err);
            res.status(500).json({ success: false, message: 'Error al guardar adjuntos' });
        }
    }
);


// ============================================================
// GET /api/tickets/adjuntos/:adjunto_id — servir archivo de forma segura
// ============================================================
router.get('/adjuntos/:adjunto_id', authMiddleware, async (req, res) => {
    try {
        const adjuntoId = parseInt(req.params.adjunto_id, 10);

        const { rows } = await db.query(`
            SELECT
                ta.nombre_original,
                ta.ruta_almacenada,
                ta.mime_type,
                ta.es_publico,
                ta.subido_por,
                t.empresa_id     AS ticket_empresa,
                t.creado_por     AS ticket_creador
            FROM app.ticket_adjuntos ta
            JOIN app.tickets t ON t.id = ta.ticket_id
            WHERE ta.id = $1
              AND t.deleted_at IS NULL
        `, [adjuntoId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Adjunto no encontrado' });
        }

        const adj = rows[0];

        const esStaff   = req.user.rol_nivel >= 3;
        const esCreador = adj.ticket_creador === req.user.id;

        // Validar multitenancy para usuarios normales
        if (!esStaff && adj.ticket_empresa !== req.user.empresa_id) {
            return res.status(403).json({ message: 'Acceso denegado' });
        }

        // Adjunto no público: solo staff puede verlo
        if (!adj.es_publico && !esStaff) {
            return res.status(403).json({ message: 'Este adjunto es solo para staff' });
        }

        // Si no es staff y no es el creador del ticket, denegar
        if (!esStaff && !esCreador) {
            return res.status(403).json({ message: 'No tenés acceso a este adjunto' });
        }

        // Construir ruta absoluta con protección de path traversal
        const rutaAbsoluta = path.resolve(UPLOADS_BASE, adj.ruta_almacenada);
        if (!rutaAbsoluta.startsWith(path.resolve(UPLOADS_BASE))) {
            return res.status(400).json({ message: 'Ruta inválida' });
        }

        if (!fs.existsSync(rutaAbsoluta)) {
            return res.status(404).json({ message: 'Archivo no encontrado en disco' });
        }

        res.setHeader('Content-Type', adj.mime_type);
        res.setHeader('Content-Disposition',
            `inline; filename="${encodeURIComponent(adj.nombre_original)}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(rutaAbsoluta);

    } catch (err) {
        console.error('GET /adjuntos/:id:', err);
        res.status(500).json({ message: 'Error interno' });
    }
});


module.exports = router;
