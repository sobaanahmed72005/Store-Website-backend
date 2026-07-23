import sharp from 'sharp';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

// Validates and re-encodes an in-memory upload via sharp before it's ever written anywhere
// (disk or object storage). This both verifies the upload is a genuinely decodable image —
// multer's fileFilter only checks the client-supplied Content-Type header, which is trivially
// spoofable — and strips any non-image bytes a polyglot file might carry, since the output is
// built fresh from decoded pixel data rather than copying input bytes. Operating on the buffer
// in memory (rather than a file already sitting in a publicly-served directory) closes the
// window where an unvalidated file was briefly reachable by URL before validation ran.
export async function sanitizeImageBuffer(buffer, { trim = false } = {}) {
  const pipeline = sharp(buffer, { animated: true });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('Unsupported or unrecognized image format');
  }

  // Logos are commonly exported on an oversized canvas with lots of transparent margin (the
  // mark itself only occupying a small fraction of the image), which makes it look tiny no
  // matter how large the display box is sized. Trimming that margin here — once, at upload —
  // means every place the logo renders gets it tightly cropped, instead of each caller having
  // to compensate for whatever padding a given upload happens to carry.
  let output = pipeline.toFormat(metadata.format);
  if (trim) output = output.trim();

  const clean = await output.toBuffer();
  return { buffer: clean, format: metadata.format };
}
