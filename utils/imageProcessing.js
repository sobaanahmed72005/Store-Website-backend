import sharp from 'sharp';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

// Validates and re-encodes an in-memory upload via sharp before it's ever written anywhere
// (disk or object storage). This both verifies the upload is a genuinely decodable image —
// multer's fileFilter only checks the client-supplied Content-Type header, which is trivially
// spoofable — and strips any non-image bytes a polyglot file might carry, since the output is
// built fresh from decoded pixel data rather than copying input bytes. Operating on the buffer
// in memory (rather than a file already sitting in a publicly-served directory) closes the
// window where an unvalidated file was briefly reachable by URL before validation ran.
export async function sanitizeImageBuffer(buffer) {
  const pipeline = sharp(buffer, { animated: true });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('Unsupported or unrecognized image format');
  }

  const clean = await pipeline.toFormat(metadata.format).toBuffer();
  return { buffer: clean, format: metadata.format };
}
