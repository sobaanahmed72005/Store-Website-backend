import fs from 'fs/promises';
import path from 'path';
import { sanitizeImageBuffer } from './imageProcessing.js';
import { uploadsDir, paymentProofsDir } from '../middleware/upload.js';
import { isObjectStorageConfigured, putObject, publicUrlFor } from './objectStorage.js';

const CONTENT_TYPE_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

// Shared by every image-upload endpoint (admin product/branding images, customer payment-proof
// screenshots): validates the file is a genuine image by its real decoded bytes (never trusting
// the client-supplied filename/extension), then writes the re-encoded result to whichever
// backend is configured — object storage (S3_BUCKET set — see utils/objectStorage.js) if this
// app is set up to scale across more than one instance, local disk otherwise.
async function processUpload(req, res, { isPaymentProof }) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let buffer, format;
  try {
    ({ buffer, format } = await sanitizeImageBuffer(req.file.buffer));
  } catch {
    return res.status(400).json({ error: 'That file is not a valid image' });
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${format}`;

  if (isObjectStorageConfigured) {
    const key = `${isPaymentProof ? 'payment-proofs' : 'uploads'}/${filename}`;
    await putObject(key, buffer, CONTENT_TYPE_BY_FORMAT[format]);
    // Payment proofs always go back through our own authenticated route regardless of storage
    // backend — only the backing bytes move to object storage, never public reachability.
    const url = isPaymentProof ? `/orders/payment-proof/${filename}` : publicUrlFor(key);
    return res.status(201).json({ url });
  }

  const dir = isPaymentProof ? paymentProofsDir : uploadsDir;
  await fs.writeFile(path.join(dir, filename), buffer);
  const url = isPaymentProof ? `/orders/payment-proof/${filename}` : `/uploads/${filename}`;
  res.status(201).json({ url });
}

export const handleImageUpload = (req, res) => processUpload(req, res, { isPaymentProof: false });
export const handlePaymentProofUpload = (req, res) => processUpload(req, res, { isPaymentProof: true });
