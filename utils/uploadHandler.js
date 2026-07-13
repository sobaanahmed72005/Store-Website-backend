import fs from 'fs/promises';
import path from 'path';
import { sanitizeUploadedImage } from './imageProcessing.js';
import { paymentProofsDir } from '../middleware/upload.js';

// Shared by every image-upload endpoint (admin product/branding images, customer payment-proof
// screenshots): validates the file is a genuine image by its real decoded bytes and renames it
// to an extension matching that validated format, never the client-supplied original filename.
export async function handleImageUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let format;
  try {
    format = await sanitizeUploadedImage(req.file.path);
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'That file is not a valid image' });
  }

  const { dir, name } = path.parse(req.file.path);
  const safeFilename = `${name}.${format}`;
  await fs.rename(req.file.path, path.join(dir, safeFilename));

  // Which multer instance handled this request (see middleware/upload.js) determines which
  // directory the file landed in — payment proofs go through the authenticated serving route
  // instead of the public /uploads static mount, since they can contain bank details/PII.
  const url = dir === paymentProofsDir ? `/orders/payment-proof/${safeFilename}` : `/uploads/${safeFilename}`;
  res.status(201).json({ url });
}
