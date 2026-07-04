import sharp from 'sharp';
import fs from 'fs/promises';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

// Re-encodes the file in place via sharp. This both verifies the upload is a genuinely
// decodable image — multer's fileFilter only checks the client-supplied Content-Type header,
// which is trivially spoofable — and strips any non-image bytes a polyglot file might carry,
// since the output is built fresh from decoded pixel data rather than copying input bytes.
export async function sanitizeUploadedImage(filePath) {
  const original = await fs.readFile(filePath);
  const pipeline = sharp(original, { animated: true });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('Unsupported or unrecognized image format');
  }

  const clean = await pipeline.toFormat(metadata.format).toBuffer();
  await fs.writeFile(filePath, clean);
  return metadata.format;
}
