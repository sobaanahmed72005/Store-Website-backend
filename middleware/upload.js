import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
// A sibling of uploads/, not a subdirectory of it — express.static's /uploads mount in server.js
// serves that whole tree recursively, so nesting this inside uploads/ would make every payment
// proof publicly fetchable by filename regardless of the authenticated route below.
export const paymentProofsDir = path.join(__dirname, '..', 'payment-proofs');

// Created eagerly rather than relying on the committed .gitkeep — a fresh deploy or an empty
// mounted volume would otherwise throw ENOENT (and 500) on the very first upload of either kind.
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(paymentProofsDir, { recursive: true });

// Every generated filename matches this exactly — used wherever a filename supplied back by a
// client (a payment_proof_image value, a :filename route param) needs to be trusted before it's
// joined onto a directory path, so a fixed shape is easier to validate than free-form input.
export const GENERATED_FILENAME_PATTERN = /^\d+-\d+\.[a-zA-Z0-9]+$/;

function makeStorage(destination) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destination),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });
}

function fileFilter(req, file, cb) {
  if (/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
}

const limits = { fileSize: 5 * 1024 * 1024 };

// Product/branding images — publicly served via the /uploads static mount in server.js.
export const upload = multer({ storage: makeStorage(uploadsDir), fileFilter, limits });

// Payment-proof screenshots — NOT covered by the /uploads static mount, since these can contain
// bank details/PII. Served only through the authenticated GET /orders/payment-proof/:filename
// route (see controllers/ordersController.js), which checks the requester owns the order or is
// an admin before streaming the file.
export const paymentProofUpload = multer({ storage: makeStorage(paymentProofsDir), fileFilter, limits });
