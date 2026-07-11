import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
}

function videoFileFilter(req, file, cb) {
  if (/^video\/(mp4|webm)$/.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only mp4 or webm video files are allowed'));
}

export const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
export const uploadVideo = multer({ storage, fileFilter: videoFileFilter, limits: { fileSize: 50 * 1024 * 1024 } });
