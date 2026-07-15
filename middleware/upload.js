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

// Local-disk fallback directories, used when S3_BUCKET isn't configured (see
// utils/objectStorage.js) — created eagerly rather than relying on the committed .gitkeep, since
// a fresh deploy or an empty mounted volume would otherwise throw ENOENT (and 500) on the very
// first upload of either kind.
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(paymentProofsDir, { recursive: true });

export { uploadsDir };

// Every generated filename matches this exactly — used wherever a filename supplied back by a
// client (a payment_proof_image value, a :filename route param) needs to be trusted before it's
// joined onto a directory path/object key, so a fixed shape is easier to validate than free-form
// input.
export const GENERATED_FILENAME_PATTERN = /^\d+-\d+\.[a-zA-Z0-9]+$/;

function fileFilter(req, file, cb) {
  if (/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
}

const limits = { fileSize: 5 * 1024 * 1024 };

// Both kinds of upload land in memory, not on disk — utils/uploadHandler.js validates/re-encodes
// the buffer via sharp and only then writes it to its final destination (local disk or object
// storage). Writing straight to a directory express.static serves (the old behavior) meant an
// unvalidated, client-named file was briefly reachable by URL before that validation ran.
const storage = multer.memoryStorage();

// Product/branding images — publicly readable once processed (served via /uploads locally, or
// directly from the bucket/CDN when S3_BUCKET is configured).
export const upload = multer({ storage, fileFilter, limits });

// Payment-proof screenshots — never publicly readable by filename, since these can contain bank
// details/PII. Served only through the authenticated GET /orders/payment-proof/:filename route
// (see controllers/ordersController.js), which checks the requester owns the order or is an
// admin before streaming the file back.
export const paymentProofUpload = multer({ storage, fileFilter, limits });
