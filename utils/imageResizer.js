import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { uploadsDir } from '../middleware/upload.js';

const ALLOWED_WIDTHS = new Set([100, 200, 300, 400, 600, 800, 900, 1200, 1400, 1920]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

export async function handleResizedUpload(req, res, next) {
  const widthParam = req.query.w;
  if (!widthParam) return next();

  const width = parseInt(widthParam, 10);
  if (isNaN(width) || !ALLOWED_WIDTHS.has(width)) return next();

  let filename;
  try {
    filename = path.basename(decodeURIComponent(req.path));
  } catch {
    return next();
  }

  if (!filename || filename === '.' || filename === '..' || filename.includes('\0')) return next();

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return next();

  // Strip existing width suffix (e.g. image-300w.jpg -> image.jpg) to find true original
  const rawBase = path.basename(filename, ext).replace(/-\d+w$/, '');
  const originalFilename = `${rawBase}${ext}`;
  const resizedFilename = `${rawBase}-${width}w${ext}`;

  const resolvedUploadsDir = path.resolve(uploadsDir);
  const originalPath = path.resolve(uploadsDir, originalFilename);
  const resizedPath = path.resolve(uploadsDir, resizedFilename);

  // Security guard against path traversal
  if (!originalPath.startsWith(resolvedUploadsDir) || !resizedPath.startsWith(resolvedUploadsDir)) {
    return next();
  }

  try {
    // Fast path: if resized cached file exists on disk, serve immediately
    try {
      await fs.access(resizedPath);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.sendFile(resizedPath, { maxAge: 31536000000, immutable: true });
    } catch {
      // Resized file does not exist yet
    }

    // Check if original file exists
    try {
      await fs.access(originalPath);
    } catch {
      return next();
    }

    // Generate resized image with Sharp
    const buffer = await fs.readFile(originalPath);
    const resizedBuffer = await sharp(buffer)
      .resize({ width, fit: 'inside', withoutEnlargement: true })
      .toBuffer();

    // Cache resized image to disk asynchronously
    fs.writeFile(resizedPath, resizedBuffer).catch(() => {});

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.type(ext).send(resizedBuffer);
  } catch {
    return next();
  }
}

