const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest = 'uploads/';
        if (file.fieldname === 'avatar') {
            dest = 'uploads/avatars/';
            if (req.params.id) {
                dest += req.params.id + '/';
            }
        } else {
            dest = 'uploads/attachments/';
        }
        
        const fullPath = path.join(__dirname, '../../', dest);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
        cb(null, fullPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

module.exports = upload;
