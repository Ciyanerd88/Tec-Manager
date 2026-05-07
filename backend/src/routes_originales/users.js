const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

router.use(authMiddleware);

// Helpers booleanos para lógica interna
const hasSuperAdmin = (req) => req.user.rol_nivel >= 5 || req.user.rol === 'superadmin';
const hasAdmin      = (req) => req.user.rol_nivel >= 4 || ['superadmin','admin'].includes(req.user.rol);
const hasTecnico    = (req) => req.user.rol_nivel >= 3 || ['superadmin','admin','tecnico'].includes(req.user.rol);

// Middlewares de protección de niveles
const checkSuperAdmin = (req, res, next) => {
    if (hasSuperAdmin(req)) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Super Admin' });
};

const checkAdmin = (req, res, next) => {
    if (hasAdmin(req)) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Administrador' });
};

const checkTecnico = (req, res, next) => {
    if (hasTecnico(req)) return next();
    return res.status(403).json({ success: false, message: 'Se requiere rol Técnico o superior' });
};

// Permisos "especiales" que solo el superadmin puede otorgar
const SPECIAL_PERMS = new Set([
    'roles.manage','auditoria.read',
    'usuarios.delete','usuarios.manage_roles','reportes.advanced',
    'usuarios.reset_password'
]);

// ─── GET /api/users  —  Lista todos los usuarios ──────────────
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT
                u.id,
                u.username,
                u.activo,
                u.verificado,
                u.debe_cambiar_password,
                u.avatar_url,
                u.ultimo_acceso,
                u.created_at,
                p.id            AS persona_id,
                p.primer_nombre,
                p.apellido,
                p.email_personal,
                p.email_trabajo,
                p.telefono_principal,
                p.cargo,
                p.departamento,
                p.numero_documento,
                r.id            AS rol_id,
                r.nombre        AS rol_nombre,
                r.color         AS rol_color,
                r.nivel         AS rol_nivel,
                e.id            AS empresa_id,
                e.nombre        AS empresa_nombre,
                (
                    SELECT COUNT(*)
                    FROM app.rol_permissions rp
                    WHERE rp.rol_id = r.id
                ) AS total_permisos
            FROM app.users u
            LEFT JOIN app.persons p ON p.id = u.persona_id
            LEFT JOIN app.roles   r ON r.id = u.rol_id
            LEFT JOIN app.empresas e ON e.id = u.empresa_id
            WHERE u.deleted_at IS NULL
            ORDER BY u.id DESC
        `);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        logger.error('Error obteniendo usuarios', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
    }
});

// ─── GET /api/users/import-template  —  Descargar plantilla Excel ──
router.get('/import-template', checkTecnico, (req, res) => {
    try {
        const xlsx = require('xlsx');
        
        // Columnas y ejemplo
        const templateData = [
            {
                username: 'ejemplo.usuario',
                password: 'password123',
                rol_id: 4,
                primer_nombre: 'Juan',
                apellido: 'Pérez',
                numero_documento: '12345678',
                email_personal: 'juan@correo.com',
                email_trabajo: 'j.perez@empresa.com',
                telefono_principal: '0981123456',
                cargo: 'Operador',
                departamento: 'Soporte',
            }
        ];

        const worksheet = xlsx.utils.json_to_sheet(templateData);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Usuarios');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=plantilla_importacion_usuarios.xlsx');
        res.send(buffer);
    } catch (error) {
        logger.error('Error generando plantilla', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al generar la plantilla' });
    }
});

// ─── POST /api/users/import  —  Importar masivo desde Excel ───
router.post('/import', checkTecnico, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo' });
        }

        const xlsx = require('xlsx');
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        // Borrar archivo temporal después de leerlo
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (data.length === 0) {
            return res.status(400).json({ success: false, message: 'El archivo está vacío' });
        }

        const results = {
            success: 0,
            errors: [],
            total: data.length
        };

        for (const row of data) {
            try {
                const { 
                    username, password, rol_id, 
                    primer_nombre, apellido, numero_documento, 
                    email_personal, email_trabajo, telefono_principal, cargo, departamento
                } = row;

                if (!username || !password) {
                    results.errors.push(`Fila con username "${username || 'VACÍO'}": Faltan datos obligatorios (username/password).`);
                    continue;
                }

                // Verificar si existe
                const exists = await db.query('SELECT id FROM app.users WHERE username=$1', [username]);
                if (exists.rows.length > 0) {
                    results.errors.push(`Usuario "${username}" ya existe. Saltado.`);
                    continue;
                }

                // Crear persona primero
                const personResult = await db.query(`
                    INSERT INTO app.persons (
                        numero_documento, primer_nombre, apellido, email_personal, 
                        email_trabajo, telefono_principal, cargo, departamento
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `, [
                    numero_documento || null, 
                    primer_nombre || '', 
                    apellido || '', 
                    email_personal || null, 
                    email_trabajo || null, 
                    telefono_principal || null, 
                    cargo || null, 
                    departamento || null
                ]);
                
                const newPersonaId = personResult.rows[0].id;
                const hash = await bcrypt.hash(String(password), 10);
                
                // Rol por defecto si no es válido
                let targetRol = parseInt(rol_id);
                if (isNaN(targetRol)) {
                    const defaultRol = await db.query("SELECT id FROM app.roles WHERE nombre='usuario' LIMIT 1");
                    targetRol = defaultRol.rows[0]?.id;
                }

                await db.query(`
                    INSERT INTO app.users (username, password_hash, persona_id, rol_id, activo, debe_cambiar_password)
                    VALUES ($1, $2, $3, $4, TRUE, TRUE)
                `, [username, hash, newPersonaId, targetRol]);

                results.success++;
            } catch (err) {
                logger.error('Error importando fila', { username: row.username, error: err.message });
                results.errors.push(`Error en "${row.username || '?' }": ${err.message}`);
            }
        }

        res.json({ 
            success: true, 
            message: `Proceso completado: ${results.success} creados, ${results.errors.length} errores.`,
            details: results
        });
    } catch (error) {
        logger.error('Error en importación masiva', { error: error.message });
        res.status(500).json({ success: false, message: 'Error interno al procesar importación' });
    }
});

// ─── GET /api/users/:id ───────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.username, u.activo, u.debe_cambiar_password, u.avatar_url, u.ultimo_acceso, u.created_at, u.updated_at,
                   p.primer_nombre, p.apellido, p.email_personal, p.email_trabajo,
                    p.telefono_principal, p.cargo, p.departamento, p.numero_documento,
                   r.id AS rol_id, r.nombre AS rol_nombre, r.color AS rol_color, r.nivel AS rol_nivel
            FROM app.users u
            LEFT JOIN app.persons p ON p.id = u.persona_id
            LEFT JOIN app.roles   r ON r.id = u.rol_id
            WHERE u.id = $1 AND u.deleted_at IS NULL
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error('Error obteniendo usuario', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener usuario' });
    }
});

// ─── POST /api/users  —  Crear usuario ───────────────────────
router.post('/', checkTecnico, async (req, res) => {
    try {
        const { 
            username, password, persona_id, rol_id, empresa_id, activo = true, debe_cambiar_password = true,
            primer_nombre, apellido, numero_documento, email_personal, email_trabajo, telefono_principal, cargo, departamento
        } = req.body;

        if (!username || !password || !empresa_id) {
            return res.status(400).json({ success: false, message: 'Username, password y empresa son requeridos' });
        }

        // 1. Verificar que el que crea tenga nivel superior o igual al rol que intenta asignar
        // (Regla específica: Admin (4) puede crear Admin (4). Técnico (3) NO puede crear Admin (4)).
        const targetRolRes = await db.query('SELECT nivel FROM app.roles WHERE id=$1', [rol_id]);
        if (targetRolRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'El rol especificado no existe' });
        }
        const targetNivel = targetRolRes.rows[0].nivel;
        const myNivel = req.user.rol_nivel || 0;

        if (myNivel === 4 && targetNivel > 4) {
            return res.status(403).json({ success: false, message: 'No puedes crear usuarios con un nivel superior al tuyo (SuperAdmin)' });
        }
        if (myNivel === 3 && targetNivel > 3) {
            return res.status(403).json({ success: false, message: 'Un técnico no puede crear usuarios administrativos' });
        }

        const exists = await db.query('SELECT id FROM app.users WHERE username=$1', [username]);
        if (exists.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'El username ya existe' });
        }

        let newPersonaId = persona_id;

        // Si se vincula persona, verificar que no tenga usuario
        if (newPersonaId) {
            const personLink = await db.query(
                'SELECT id FROM app.users WHERE persona_id=$1 AND deleted_at IS NULL', [newPersonaId]
            );
            if (personLink.rows.length > 0) {
                return res.status(400).json({ success: false, message: 'Esa persona ya tiene un usuario' });
            }
        } else if (primer_nombre || apellido || numero_documento) {
            // Si no hay persona_id pero sí hay nombre o documento, creamos la persona
            const docNumber = numero_documento || `ND-${Date.now()}`;
            const personResult = await db.query(`
                INSERT INTO app.persons (tipo_documento, numero_documento, primer_nombre, apellido, email_personal, email_trabajo, telefono_principal, cargo, departamento, usuario_creador_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
            `, ['DNI', docNumber, primer_nombre, apellido, email_personal || null, email_trabajo || null, telefono_principal || null, cargo || null, departamento || null, req.user.id]);
            newPersonaId = personResult.rows[0].id;
        }

        const hash = await bcrypt.hash(password, 10);

        // Por defecto rol "usuario" si no se especifica (aunque aquí ya validamos rol_id arriba)
        const targetRol = rol_id || (await db.query(
            "SELECT id FROM app.roles WHERE nombre='usuario' LIMIT 1"
        )).rows[0]?.id;

        const result = await db.query(`
            INSERT INTO app.users (username, password_hash, persona_id, rol_id, empresa_id, activo, debe_cambiar_password)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, username, activo
        `, [username, hash, newPersonaId || null, targetRol, empresa_id, activo, debe_cambiar_password]);

        res.status(201).json({ success: true, message: 'Usuario creado exitosamente', data: result.rows[0] });
    } catch (error) {
        logger.error('Error creando usuario', { error: error.message });
        res.status(500).json({ success: false, message: `Error interno al crear usuario: ${error.message}` });
    }
});

// ─── PUT /api/users/:id  —  Actualizar datos del usuario ─────
//     SuperAdmin/Admin pueden cambiar todo; el propio usuario puede cambiar su password
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const requester = req.user;
    const isSelf    = String(requester.id) === String(id);
    const myNivel   = requester.rol_nivel || 0;

    try {
        // Obtener el nivel del usuario que se quiere editar
        const targetUserRes = await db.query(`
            SELECT u.*, r.nivel as rol_nivel 
            FROM app.users u 
            LEFT JOIN app.roles r ON r.id = u.rol_id 
            WHERE u.id = $1
        `, [id]);
        
        if (targetUserRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        const targetUser = targetUserRes.rows[0];

        // Validar jerarquía: solo se puede editar a alguien de nivel INFERIOR O IGUAL (excepto superadmin)
        // El usuario sí puede editarse a sí mismo (para cambiar password/avatar)
        if (!isSelf && myNivel < 5 && myNivel < targetUser.rol_nivel) {
            return res.status(403).json({ success: false, message: 'No tienes permisos para modificar usuarios de nivel superior' });
        }

        // Si no es técnico/admin y no es sí mismo, denegar
        if (!hasTecnico(req) && !isSelf) {
            return res.status(403).json({ success: false, message: 'Sin permisos para modificar este usuario' });
        }

        // Si es técnico o admin (nivel < 5), no puede editar a alguien de nivel >= 4 (Admin/SuperAdmin)
        // A menos que sea él mismo.
        if (myNivel < 5 && targetUser.rol_nivel >= 4 && !isSelf) {
            return res.status(403).json({ success: false, message: 'No tienes jerarquía para modificar a este usuario' });
        }

        const {
            username, password, rol_id, empresa_id, activo,
            debe_cambiar_password, avatar_url,
            // Datos de persona
            numero_documento, primer_nombre, apellido, email_personal, email_trabajo,
            telefono_principal, cargo, departamento
        } = req.body;

        // Actualizar datos de usuario
        const userFields = [];
        const userValues = [];

        if (username && hasTecnico(req)) {
            userFields.push(`username = $${userValues.push(username)}`);
        }
        if (password) {
            if (password.length < 8) {
                return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
            }
            const hash = await bcrypt.hash(password, 10);
            userFields.push(`password_hash = $${userValues.push(hash)}`);
            userFields.push(`ultimo_cambio_password = NOW()`);
        }
        
        // Cambio de rol: Validar jerarquía del NUEVO rol
        if (rol_id && hasTecnico(req)) {
            const newRole = await db.query('SELECT nivel FROM app.roles WHERE id=$1', [rol_id]);
            const newNivel = newRole.rows[0]?.nivel ?? 0;
            // Admin (4) puede crear/asignar hasta Nivel 4. Técnico (3) solo hasta Nivel 3.
            if (myNivel === 4 && newNivel > 4) {
                return res.status(403).json({ success: false, message: 'No puedes asignar un rol superior al tuyo' });
            }
            if (myNivel === 3 && newNivel > 3) {
                return res.status(403).json({ success: false, message: 'Un técnico no puede asignar roles administrativos' });
            }
            userFields.push(`rol_id = $${userValues.push(rol_id)}`);
        }
        if (typeof activo === 'boolean' && hasTecnico(req)) {
            userFields.push(`activo = $${userValues.push(activo)}`);
        }
        if (typeof debe_cambiar_password === 'boolean' && hasTecnico(req)) {
            userFields.push(`debe_cambiar_password = $${userValues.push(debe_cambiar_password)}`);
        }
        if (avatar_url !== undefined) {
            userFields.push(`avatar_url = $${userValues.push(avatar_url)}`);
        }
        if (empresa_id && hasTecnico(req)) {
            userFields.push(`empresa_id = $${userValues.push(empresa_id)}`);
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            if (userFields.length > 0) {
                userValues.push(id);
                await client.query(
                    `UPDATE app.users SET ${userFields.join(', ')}, updated_at=NOW() WHERE id = $${userValues.length}`,
                    userValues
                );
            }

            // Actualizar persona si se pasaron datos y es técnico/admin
            if (hasTecnico(req) && (numero_documento !== undefined || primer_nombre || apellido || email_personal || email_trabajo || telefono_principal || cargo || departamento)) {
                const personFields = [];
                const personValues = [];

                if (numero_documento !== undefined) personFields.push(`numero_documento=$${personValues.push(numero_documento || null)}`);
                if (primer_nombre) personFields.push(`primer_nombre=$${personValues.push(primer_nombre)}`);
                if (apellido)      personFields.push(`apellido=$${personValues.push(apellido)}`);
                if (email_personal !== undefined) personFields.push(`email_personal=$${personValues.push(email_personal)}`);
                if (email_trabajo  !== undefined) personFields.push(`email_trabajo=$${personValues.push(email_trabajo)}`);
                if (telefono_principal !== undefined) personFields.push(`telefono_principal=$${personValues.push(telefono_principal)}`);
                if (cargo      !== undefined) personFields.push(`cargo=$${personValues.push(cargo)}`);
                if (departamento !== undefined) personFields.push(`departamento=$${personValues.push(departamento)}`);

                const existingPersonaId = targetUser.persona_id;

                if (existingPersonaId && personFields.length > 0) {
                    // UPDATE existente
                    personValues.push(existingPersonaId);
                    await client.query(`
                        UPDATE app.persons SET ${personFields.join(', ')}
                        WHERE id = $${personValues.length}
                    `, personValues);
                } else if (!existingPersonaId && personFields.length > 0) {
                    // INSERT nueva persona — columnas dinámicas según campos recibidos
                    // empresa_id es NOT NULL, siempre se incluye desde el usuario
                    const empresaIdx = personValues.push(targetUser.empresa_id);
                    personFields.push(`empresa_id=$${empresaIdx}`);

                    const colNames = personFields.map(f => f.split('=')[0].trim()).join(', ');
                    const placeholders = personValues.map((_, i) => `$${i + 1}`).join(', ');
                    const insertResult = await client.query(`
                        INSERT INTO app.persons (${colNames})
                        VALUES (${placeholders})
                        RETURNING id
                    `, personValues);
                    const newId = insertResult.rows[0].id;

                    // Vincular al usuario
                    await client.query('UPDATE app.users SET persona_id = $1 WHERE id = $2', [newId, id]);
                }
            }

            await client.query('COMMIT');
        } catch (txError) {
            await client.query('ROLLBACK');
            if (txError.code === '23505' && txError.constraint?.includes('numero_documento')) {
                return res.status(409).json({ success: false, message: 'El número de documento ya está registrado para otra persona.' });
            }
            throw txError;
        } finally {
            client.release();
        }

        // Devolver usuario actualizado
        const updated = await db.query(`
            SELECT u.id, u.username, u.activo, u.debe_cambiar_password,
                   p.numero_documento, p.primer_nombre, p.apellido, p.email_personal,
                   r.id AS rol_id, r.nombre AS rol_nombre, r.nivel AS rol_nivel
            FROM app.users u
            LEFT JOIN app.persons p ON p.id = u.persona_id
            LEFT JOIN app.roles   r ON r.id = u.rol_id
            WHERE u.id = $1
        `, [id]);

        res.json({ success: true, message: 'Usuario actualizado exitosamente', data: updated.rows[0] });
    } catch (error) {
        logger.error('Error actualizando usuario', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
    }
});

// ─── POST /api/users/:id/reset-password  —  Resetear contraseña temporal ─
router.post('/:id/reset-password', checkAdmin, async (req, res) => {
    try {
        const { new_password } = req.body;
        if (!new_password || new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'La contraseña debe tener mínimo 6 caracteres' });
        }

        const targetRes = await db.query(`
            SELECT u.id, r.nivel AS rol_nivel
            FROM app.users u
            LEFT JOIN app.roles r ON r.id = u.rol_id
            WHERE u.id = $1 AND u.deleted_at IS NULL
        `, [req.params.id]);

        if (!targetRes.rows.length) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const target = targetRes.rows[0];
        const myNivel = req.user.rol_nivel || 0;

        // Jerarquía: no puedes resetear contraseña de alguien con igual o mayor nivel (a menos que seas superadmin)
        if (!hasSuperAdmin(req) && target.rol_nivel >= myNivel) {
            return res.status(403).json({ success: false, message: 'No puedes resetear la contraseña de un usuario con igual o mayor nivel de rol' });
        }

        const hash = await bcrypt.hash(new_password, 10);
        await db.query(`
            UPDATE app.users
            SET password_hash = $1, debe_cambiar_password = TRUE, updated_at = NOW()
            WHERE id = $2
        `, [hash, req.params.id]);

        logger.info('Contraseña reseteada', { targetId: req.params.id, by: req.user.id });
        res.json({ success: true, message: 'Contraseña reseteada. El usuario deberá cambiarla en su próximo inicio de sesión.' });
    } catch (error) {
        logger.error('Error reseteando contraseña', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al resetear contraseña' });
    }
});

// ─── DELETE /api/users/:id  —  Soft delete ───────────────────
router.delete('/:id', checkAdmin, async (req, res) => {
    try {
        await db.query(
            'UPDATE app.users SET deleted_at=NOW(), activo=FALSE WHERE id=$1', [req.params.id]
        );
        res.json({ success: true, message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        logger.error('Error eliminando usuario', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
    }
});

// ─── GET /api/users/:id/permissions  —  Permisos actuales del rol del usuario ─
router.get('/:id/permissions', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT p.id, p.nombre, p.modulo, p.accion, p.descripcion
            FROM app.permissions p
            INNER JOIN app.rol_permissions rp ON rp.permiso_id = p.id
            INNER JOIN app.users u ON u.rol_id = rp.rol_id
            WHERE u.id = $1 AND u.deleted_at IS NULL
            ORDER BY p.modulo, p.accion
        `, [req.params.id]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        logger.error('Error obteniendo permisos del usuario', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al obtener permisos' });
    }
});

// ─── PATCH /api/users/:id/role-permissions/:permId  —  Toggle permiso del rol del usuario ─
//   El permiso se aplica al ROL del usuario (no individualmente)
//   SuperAdmin: puede todo | Admin: no puede permisos especiales | Tecnico: muy limitado
router.patch('/:id/role-permissions/:permId', checkTecnico, async (req, res) => {
    const { id: userId, permId } = req.params;
    const { enabled } = req.body;

    try {
        // Obtener el rol del usuario
        const userRes = await db.query(
            'SELECT rol_id FROM app.users WHERE id=$1 AND deleted_at IS NULL', [userId]
        );
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        const { rol_id } = userRes.rows[0];

        // Verificar si el permiso es "especial"
        const permRes = await db.query('SELECT nombre FROM app.permissions WHERE id=$1', [permId]);
        if (permRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permiso no encontrado' });
        }
        const permNombre = permRes.rows[0].nombre;
        const isSpecial  = SPECIAL_PERMS.has(permNombre);

        // Solo superadmin puede manejar permisos especiales
        if (isSpecial && !hasSuperAdmin(req)) {
            return res.status(403).json({
                success: false,
                message: `El permiso "${permNombre}" es especial y solo puede otorgarlo el Super Admin`
            });
        }

        // Técnicos y Admins pueden gestionar el resto de permisos comunes
        // (No hace falta check extra aquí ya que checkTecnico ya valida el nivel 3)

        // Aplicar el toggle al ROL del usuario
        if (enabled) {
            await db.query(
                'INSERT INTO app.rol_permissions (rol_id, permiso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                [rol_id, permId]
            );
        } else {
            await db.query(
                'DELETE FROM app.rol_permissions WHERE rol_id=$1 AND permiso_id=$2',
                [rol_id, permId]
            );
        }

        res.json({
            success: true,
            message: enabled ? `Permiso "${permNombre}" otorgado` : `Permiso "${permNombre}" revocado`,
            enabled,
            permNombre,
            isSpecial
        });
    } catch (error) {
        logger.error('Error en toggle de permiso de usuario', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al actualizar permiso' });
    }
});

// ─── POST /api/users/:id/avatar  —  Subir avatar ──────────────
router.post('/:id/avatar', upload.single('avatar'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo' });
        }

        const avatarUrl = `/uploads/avatars/${id}/${req.file.filename}`;

        // Obtener avatar anterior para borrarlo
        const oldUser = await db.query('SELECT avatar_url FROM app.users WHERE id = $1', [id]);
        if (oldUser.rows[0]?.avatar_url) {
            const oldPath = path.join(__dirname, '../../', oldUser.rows[0].avatar_url);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        // Actualizar en DB
        await db.query('UPDATE app.users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, id]);

        res.json({ success: true, message: 'Avatar actualizado', avatar_url: avatarUrl });
    } catch (error) {
        logger.error('Error subiendo avatar', { error: error.message });
        res.status(500).json({ success: false, message: 'Error interno al procesar el avatar' });
    }
});

// ─── DELETE /api/users/:id/avatar  —  Eliminar avatar ──────────
router.delete('/:id/avatar', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await db.query('SELECT avatar_url FROM app.users WHERE id = $1', [id]);
        
        if (user.rows[0]?.avatar_url) {
            const filePath = path.join(__dirname, '../../', user.rows[0].avatar_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await db.query('UPDATE app.users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1', [id]);
        res.json({ success: true, message: 'Avatar eliminado' });
    } catch (error) {
        logger.error('Error eliminando avatar', { error: error.message });
        res.status(500).json({ success: false, message: 'Error al eliminar el avatar' });
    }
});



module.exports = router;
