import fs from 'fs/promises';
import path from 'path';
import { sanitizeImageBuffer, extractIconCrop } from './imageProcessing.js';
import { verifyUploadedVideo } from './videoProcessing.js';
import { uploadsDir, paymentProofsDir } from '../middleware/upload.js';
import { isObjectStorageConfigured, putObject, publicUrlFor } from './objectStorage.js';

const CONTENT_TYPE_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const VIDEO_CONTENT_TYPE_BY_FORMAT = { mp4: 'video/mp4', webm: 'video/webm' };

// Shared by every image-upload endpoint (admin product/branding images, customer payment-proof
// screenshots): validates the file is a genuine image by its real decoded bytes (never trusting
// the client-supplied filename/extension), then writes the re-encoded result to whichever
// backend is configured — object storage (S3_BUCKET set — see utils/objectStorage.js) if this
// app is set up to scale across more than one instance, local disk otherwise.
async function processUpload(req, res, { isPaymentProof }) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const isLogo = req.body?.purpose === 'logo';
  // A dedicated favicon upload (for logos where extractIconCrop below can't find a clean split —
  // e.g. a glow/wordmark design with no real transparent gap between the icon and the text) is
  // already meant to be the icon, so it gets trimmed like a logo but is never run back through
  // extractIconCrop itself.
  const isFavicon = req.body?.purpose === 'favicon';
  let buffer, format;
  try {
    ({ buffer, format } = await sanitizeImageBuffer(req.file.buffer, { trim: isLogo || isFavicon }));
  } catch {
    return res.status(400).json({ error: 'That file is not a valid image' });
  }

  // Best-effort: a logo without a separable icon segment (e.g. a plain wordmark) just doesn't
  // get a favicon crop, and the caller falls back to the full logo — never a hard failure.
  let iconBuffer = null;
  if (isLogo) {
    try { iconBuffer = await extractIconCrop(buffer, format); } catch { /* no crop, fall back to full logo */ }
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${format}`;
  const iconFilename = iconBuffer ? `${Date.now()}-${Math.round(Math.random() * 1e9)}-icon.${format}` : null;

  if (isObjectStorageConfigured) {
    const key = `${isPaymentProof ? 'payment-proofs' : 'uploads'}/${filename}`;
    await putObject(key, buffer, CONTENT_TYPE_BY_FORMAT[format]);
    // Payment proofs always go back through our own authenticated route regardless of storage
    // backend — only the backing bytes move to object storage, never public reachability.
    const url = isPaymentProof ? `/orders/payment-proof/${filename}` : publicUrlFor(key);

    let faviconUrl;
    if (iconBuffer) {
      const iconKey = `uploads/${iconFilename}`;
      await putObject(iconKey, iconBuffer, CONTENT_TYPE_BY_FORMAT[format]);
      faviconUrl = publicUrlFor(iconKey);
    }
    return res.status(201).json(faviconUrl ? { url, faviconUrl } : { url });
  }

  const dir = isPaymentProof ? paymentProofsDir : uploadsDir;
  await fs.writeFile(path.join(dir, filename), buffer);
  const url = isPaymentProof ? `/orders/payment-proof/${filename}` : `/uploads/${filename}`;

  let faviconUrl;
  if (iconBuffer) {
    await fs.writeFile(path.join(uploadsDir, iconFilename), iconBuffer);
    faviconUrl = `/uploads/${iconFilename}`;
  }
  res.status(201).json(faviconUrl ? { url, faviconUrl } : { url });
}

export const handleImageUpload = (req, res) => processUpload(req, res, { isPaymentProof: false });
export const handlePaymentProofUpload = (req, res) => processUpload(req, res, { isPaymentProof: true });

// Verifies the file's real leading bytes match a known video container (see videoProcessing.js
// for why this can't re-encode the way sanitizeImageBuffer does), then writes it under a
// generated filename, never the client-supplied original — same in-memory-buffer + object-storage
// pattern as processUpload above, since uploadVideo uses the same memoryStorage as every other
// upload type.
export async function handleVideoUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let format;
  try {
    format = verifyUploadedVideo(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'That file is not a valid video' });
  }

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${format}`;

  if (isObjectStorageConfigured) {
    const key = `uploads/${filename}`;
    await putObject(key, req.file.buffer, VIDEO_CONTENT_TYPE_BY_FORMAT[format]);
    return res.status(201).json({ url: publicUrlFor(key) });
  }

  await fs.writeFile(path.join(uploadsDir, filename), req.file.buffer);
  res.status(201).json({ url: `/uploads/${filename}` });
}
