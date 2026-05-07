const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const logger = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');

// Generate JWT Token
const generateToken = (user, roleInfo = {}) => {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            email: user.email_personal,
            rol: user.rol,
            rol_id: user.rol_id,
            rol_nivel: roleInfo.nivel || null
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
    );
};

// @route   POST /api/auth/register
// @desc    Register new user
// @access  DISABLED - Users must be created through /api/users with person_id
router.post('/register', async (req, res) => {
    return res.status(501).json({
        success: false,
        message: 'El registro directo está deshabilitado. Los usuarios deben crearse a través de Gestión de Usuarios con una persona asociada.'
    });
});

// @route   POST /api/auth/request-access
// @desc    Solicitud pública de acceso al sistema (sin autenticación)
// @access  Public
router.post('/request-access', async (req, res) => {
    try {
        const { nombre, email, empresa, telefono, motivo } = req.body;

        if (!nombre || !email) {
            return res.status(400).json({ success: false, message: 'Nombre y correo son requeridos' });
        }

        const clientIp = req.ip || req.socket.remoteAddress;
        const emailNorm = email.trim().toLowerCase();

        // ── Rate limiting ────────────────────────────────────────────────
        // 1. Mismo email con solicitud pendiente o reciente (últimas 24 h)
        const emailCheck = await db.query(
            `SELECT id FROM app.account_requests
             WHERE LOWER(email) = $1
               AND (estado = 'pendiente' OR created_at > NOW() - INTERVAL '24 hours')
             LIMIT 1`,
            [emailNorm]
        );
        if (emailCheck.rows.length) {
            return res.status(429).json({
                success: false,
                message: 'Ya existe una solicitud registrada con ese correo. Aguardá que un técnico se comunique contigo.'
            });
        }

        // 2. Misma IP: máximo 3 solicitudes en las últimas 24 h
        const ipCheck = await db.query(
            `SELECT COUNT(*) AS total FROM app.account_requests
             WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
            [clientIp]
        );
        if (parseInt(ipCheck.rows[0].total) >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Demasiadas solicitudes desde esta red. Intentá de nuevo mañana.'
            });
        }
        // ─────────────────────────────────────────────────────────────────

        // Buscar la empresa con más admins para alojar el ticket (empresa_id obligatorio)
        const empresaRes = await db.query(
            `SELECT u.empresa_id FROM app.users u
             JOIN app.roles r ON r.id = u.rol_id
             WHERE u.activo = true AND u.deleted_at IS NULL AND r.nivel >= 4
             ORDER BY r.nivel DESC LIMIT 1`
        );
        if (!empresaRes.rows.length) {
            return res.status(500).json({ success: false, message: 'No hay administradores disponibles para recibir la solicitud' });
        }
        const empresaId = empresaRes.rows[0].empresa_id;

        // Armar descripción del ticket
        const descripcion = [
            `Nombre: ${nombre.trim()}`,
            `Email: ${emailNorm}`,
            empresa  ? `Empresa: ${empresa.trim()}`  : null,
            telefono ? `Teléfono: ${telefono.trim()}` : null,
            motivo   ? `Motivo: ${motivo.trim()}`     : null,
        ].filter(Boolean).join('\n');

        // Crear ticket sin usuario_creador_id (solicitud externa, sin cuenta)
        const taskRes = await db.query(
            `INSERT INTO app.tasks
                (empresa_id, usuario_creador_id, titulo, descripcion, tipo_ticket, prioridad, ip_address)
             VALUES ($1, NULL, $2, $3, 'solicitud_acceso', 'alta', $4)
             RETURNING id`,
            [empresaId, `Solicitud de acceso: ${nombre.trim()}`, descripcion, clientIp]
        );
        const taskId = taskRes.rows[0].id;

        // Guardar en account_requests enlazado al ticket
        await db.query(
            `INSERT INTO app.account_requests (nombre, email, empresa, telefono, motivo, task_id, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [nombre.trim(), emailNorm, empresa?.trim() || null, telefono?.trim() || null, motivo?.trim() || null, taskId, clientIp]
        );

        res.status(201).json({
            success: true,
            message: 'Solicitud enviada. Un técnico revisará tu pedido y se pondrá en contacto contigo.'
        });
    } catch (e) {
        console.error('Error en request-access:', e);
        res.status(500).json({ success: false, message: 'Error al enviar la solicitud' });
    }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Trim whitespace from inputs
        const trimmedUsername = username?.trim();
        const trimmedPassword = password; // Do not trim passwords, they can contain spaces

        // Validate input
        if (!trimmedUsername || !trimmedPassword) {
            return res.status(400).json({
                success: false,
                message: 'Por favor proporciona usuario y contraseña'
            });
        }

        // Check if user exists
        const result = await db.query(
            `SELECT u.*, p.primer_nombre, p.apellido, p.email_personal, p.email_trabajo
             FROM app.users u
             INNER JOIN app.persons p ON u.persona_id = p.id
             WHERE LOWER(u.username) = LOWER($1) AND u.activo = true AND u.deleted_at IS NULL`,
            [trimmedUsername]
        );

        if (result.rows.length === 0) {
            // Log failed attempt
            await db.query(
                'INSERT INTO app.login_attempts (username, exitoso, motivo_fallo, ip_address) VALUES ($1, false, $2, $3)',
                [trimmedUsername, 'Usuario no encontrado', req.ip]
            );

            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        const user = result.rows[0];

        // Check if account is locked
        if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
            return res.status(403).json({
                success: false,
                message: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos'
            });
        }

        // Verify password
        logger.info('Login attempt for: ' + trimmedUsername);
        logger.info('Password provided length: ' + (trimmedPassword?.length || 0));
        const isMatch = await bcrypt.compare(trimmedPassword, user.password_hash);
        logger.info('Is match: ' + isMatch);

        if (!isMatch) {
            // Increment failed attempts
            const intentos = user.intentos_fallidos + 1;
            let bloqueadoHasta = null;

            if (intentos >= 5) {
                // Block for 30 minutes
                bloqueadoHasta = new Date(Date.now() + 30 * 60 * 1000);
            }

            await db.query(
                'UPDATE app.users SET intentos_fallidos = $1, bloqueado_hasta = $2 WHERE id = $3',
                [intentos, bloqueadoHasta, user.id]
            );

            // Log failed attempt
            await db.query(
                'INSERT INTO app.login_attempts (username, exitoso, motivo_fallo, ip_address) VALUES ($1, false, $2, $3)',
                [trimmedUsername, 'Contraseña incorrecta', req.ip]
            );

            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Reset failed attempts on successful login
        await db.query(
            `UPDATE app.users SET
             intentos_fallidos = 0,
             bloqueado_hasta = NULL,
             ultimo_acceso = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [user.id]
        );

        // Log successful attempt
        await db.query(
            'INSERT INTO app.login_attempts (username, exitoso, ip_address) VALUES ($1, true, $2)',
            [trimmedUsername, req.ip]
        );

        // Get user role (in new schema, users have one direct role)
        const rolesResult = await db.query(`
            SELECT r.id, r.nombre, r.color, r.nivel, r.descripcion
            FROM app.roles r
            WHERE r.id = $1
        `, [user.rol_id]);

        // Get user permissions (from the user's role)
        const permissionsResult = await db.query(`
            SELECT DISTINCT p.nombre, p.modulo, p.accion, p.descripcion
            FROM app.permissions p
            INNER JOIN app.rol_permissions rp ON p.id = rp.permiso_id
            WHERE rp.rol_id = $1
            ORDER BY p.modulo, p.accion
        `, [user.rol_id]);

        // Get role info
        const roleInfo = rolesResult.rows[0] || {};

        // Generate token (include role level for superadmin detection)
        const token = generateToken(user, roleInfo);

        res.json({
            success: true,
            message: 'Login exitoso',
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email_trabajo || user.email_personal,
                    nombre: `${user.primer_nombre} ${user.apellido}`,
                    rol: roleInfo.nombre,
                    rol_nivel: roleInfo.nivel,
                    rol_color: roleInfo.color,
                    debe_cambiar_password: user.debe_cambiar_password,
                    avatar_url: user.avatar_url,
                    roles: rolesResult.rows,
                    permisos: permissionsResult.rows
                },
                token
            }
        });
    } catch (error) {
        logger.error('Error en login', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Error al iniciar sesión'
        });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.username, p.email_trabajo as email, p.email_personal,
                    CONCAT(p.primer_nombre, ' ', p.apellido) as nombre,
                    r.nombre as rol, r.nivel as rol_nivel, r.color as rol_color,
                    u.avatar_url, u.rol_id, u.debe_cambiar_password
             FROM app.users u
             INNER JOIN app.persons p ON u.persona_id = p.id
             INNER JOIN app.roles r ON u.rol_id = r.id
             WHERE u.id = $1 AND u.deleted_at IS NULL AND u.activo = true`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        // Refresh permissions from DB (always fresh)
        const permissionsResult = await db.query(`
            SELECT DISTINCT p.nombre, p.modulo, p.accion, p.descripcion
            FROM app.permissions p
            INNER JOIN app.rol_permissions rp ON p.id = rp.permiso_id
            WHERE rp.rol_id = $1
            ORDER BY p.modulo, p.accion
        `, [result.rows[0].rol_id]);

        const userData = {
            ...result.rows[0],
            permisos: permissionsResult.rows
        };

        res.json({
            success: true,
            data: userData
        });
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener información del usuario'
        });
    }
});

// @route   GET /api/auth/users
// @desc    Get all users (for task assignment)
// @access  Private
router.get('/users', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.username, per.email_trabajo as email,
                    CONCAT(per.primer_nombre, ' ', per.apellido) as nombre,
                    r.nombre as rol, u.avatar_url
             FROM app.users u
             INNER JOIN app.persons per ON u.persona_id = per.id
             INNER JOIN app.roles r ON u.rol_id = r.id
             WHERE u.activo = true AND u.deleted_at IS NULL
             ORDER BY per.primer_nombre, per.apellido`
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener usuarios'
        });
    }
});

// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private
router.post('/change-password', authMiddleware, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere contraseña actual y nueva'
            });
        }

        // Validate password strength
        if (new_password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe tener al menos 8 caracteres'
            });
        }

        // Validate complexity
        const hasUppercase = /[A-Z]/.test(new_password);
        const hasLowercase = /[a-z]/.test(new_password);
        const hasNumber = /[0-9]/.test(new_password);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(new_password);

        if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña debe contener mayúsculas, minúsculas, números y caracteres especiales'
            });
        }

        // Get user
        const userResult = await db.query('SELECT * FROM app.users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];

        // Verify current password
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Contraseña actual incorrecta'
            });
        }

        //Check password history (last 3 passwords)
        const historyResult = await db.query(`
            SELECT password_hash FROM app.password_history
            WHERE usuario_id = $1
            ORDER BY created_at DESC
            LIMIT 3
        `, [req.user.id]);

        for (const record of historyResult.rows) {
            const isReused = await bcrypt.compare(new_password, record.password_hash);
            if (isReused) {
                return res.status(400).json({
                    success: false,
                    message: 'No puedes reutilizar una contraseña reciente'
                });
            }
        }

        // Save current password to history
        await db.query(`
            INSERT INTO app.password_history (usuario_id, password_hash)
            VALUES ($1, $2)
        `, [req.user.id, user.password_hash]);

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(new_password, salt);

        // Update password
        await db.query(`
            UPDATE app.users
            SET password_hash = $1,
                debe_cambiar_password = false,
                ultimo_cambio_password = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [newPasswordHash, req.user.id]);

        // Log activity
        await db.query(`
            INSERT INTO audit.activity_log (usuario_id, accion, modulo, descripcion, ip_address)
            VALUES ($1, 'cambio_password', 'auth', 'Usuario cambió su contraseña', $2)
        `, [req.user.id, req.ip]);

        res.json({
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({
            success: false,
            message: 'Error al cambiar contraseña'
        });
    }
});

// @route   GET /api/auth/check-password-required
// @desc    Check if user needs to change password
// @access  Private
router.get('/check-password-required', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT debe_cambiar_password FROM app.users WHERE id = $1',
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                debe_cambiar_password: result.rows[0]?.debe_cambiar_password || false
            }
        });
    } catch (error) {
        console.error('Error verificando contraseña:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar estado'
        });
    }
});

module.exports = router;
