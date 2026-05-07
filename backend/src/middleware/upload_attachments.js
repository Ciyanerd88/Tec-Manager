// backend/src/middleware/upload_attachments.js
// ============================================================
// MIDDLEWARE DE CARGA DE ARCHIVOS
// Almacenamiento seguro en estructura multitenant
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const UPLOADS_BASE = process.env.UPLOADS_PATH || path.join(__dirname, '../../uploads');

// Tipos de archivo permitidos
const MIME_PERMITIDOS = {
    'image/jpeg':      { ext: 'jpg',  tipo: 'imagen' },
    'image/png':       { ext: 'png',  tipo: 'imagen' },
    'image/gif':       { ext: 'gif',  tipo: 'imagen' },
    'image/webp':      { ext: 'webp', tipo: 'imagen' },
    'application/pdf': { ext: 'pdf',  tipo: 'documento' },
    'application/msword': { ext: 'doc', tipo: 'documento' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                       { ext: 'docx', tipo: 'documento' },
    'text/plain':      { ext: 'txt',  tipo: 'documento' },
    'video/mp4':       { ext: 'mp4',  tipo: 'video' },
};

const MAX_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_MB || '10') * 1024 * 1024;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!req.user?.empresa_id) {
            return cb(new Error('Contexto de empresa no disponible'));
        }

        let dir;
        if (req.params?.id) {
            // Estructura nueva: uploads/{empresa_id}/tickets/{ticket_id}/
            dir = path.join(
                UPLOADS_BASE,
                String(req.user.empresa_id),
                'tickets',
                String(req.params.id)
            );
        } else {
            // Caso legacy o creación inicial: uploads/attachments/{yyyy-mm-dd}/
            const today = new Date().toISOString().split('T')[0];
            dir = path.join(UPLOADS_BASE, 'attachments', today);
        }

        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },

    filename: (req, file, cb) => {
        const mime_info = MIME_PERMITIDOS[file.mimetype];
        if (!mime_info) return cb(new Error('Tipo de archivo no permitido'));

        // UUID v4 como nombre → evita colisiones y no expone el nombre original
        const uuid = crypto.randomUUID();
        cb(null, `${uuid}.${mime_info.ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (MIME_PERMITIDOS[file.mimetype]) {
        cb(null, true);
    } else {
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE',
            `Tipo no permitido: ${file.mimetype}. Permitidos: imágenes, PDF, Word, TXT, MP4`));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES, files: 5 }
});

/**
 * Middleware que expone multer con manejo de errores
 * Uso: router.post('/:id/adjuntos', authMiddleware, uploadAdjunto, controller)
 */
const uploadAdjunto = (req, res, next) => {
    upload.array('adjuntos', 5)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            const msgs = {
                LIMIT_FILE_SIZE: `El archivo supera el máximo permitido (${process.env.MAX_UPLOAD_MB || 10} MB)`,
                LIMIT_FILE_COUNT: 'Máximo 5 archivos por solicitud',
                LIMIT_UNEXPECTED_FILE: err.message
            };
            return res.status(400).json({
                success: false,
                message: msgs[err.code] || 'Error al subir el archivo'
            });
        }
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
};

// Exportar el objeto multer directamente para compatibilidad con rutas legacy (tasks.js)
// Y adjuntar las utilidades nuevas
upload.uploadAdjunto = uploadAdjunto;
upload.MIME_PERMITIDOS = MIME_PERMITIDOS;

module.exports = upload;
