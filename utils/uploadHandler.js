import fs from 'fs/promises';
import path from 'path';
import { sanitizeUploadedImage } from './imageProcessing.js';
import { verifyUploadedVideo } from './videoProcessing.js';

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

  res.status(201).json({ url: `/uploads/${safeFilename}` });
}

// Verifies the file's real leading bytes match a known video container (see videoProcessing.js
// for why this can't re-encode the way handleImageUpload does) and renames it to an extension
// matching that validated format, never the client-supplied original filename.
export async function handleVideoUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let format;
  try {
    format = await verifyUploadedVideo(req.file.path);
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'That file is not a valid video' });
  }

  const { dir, name } = path.parse(req.file.path);
  const safeFilename = `${name}.${format}`;
  await fs.rename(req.file.path, path.join(dir, safeFilename));

  res.status(201).json({ url: `/uploads/${safeFilename}` });
}
