const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, '../../uploads/temp/');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, 'import-' + Date.now() + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const filetypes = /xlsx|xls|csv/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.mimetype === 'application/vnd.ms-excel';

    if (mimetype || extname) {
        return cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls) o CSV'));
    }
};

const uploadExcel = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = uploadExcel;
