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

// Many logos are a wordmark: a small icon glyph followed by the business name. That's fine as
// the full logo, but used directly as a favicon it crams the whole name into a 16-32px square —
// illegible mush rather than a clean icon. Real favicons are just the mark, so this looks for a
// vertical gap of transparency that separates the icon from the text next to it (scanning column
// by column for where content starts and where it ends) and crops a square out of just that
// segment. Returns null when no such gap is found (e.g. the logo has no separate icon segment,
// or is a single solid wordmark) — callers should fall back to using the full logo as-is rather
// than guessing at a crop that isn't there.
export async function extractIconCrop(buffer, format) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ALPHA_THRESHOLD = 20;

  const columnHasContent = new Array(width).fill(false);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * channels + (channels - 1)] > ALPHA_THRESHOLD) {
        columnHasContent[x] = true;
        break;
      }
    }
  }

  const firstContent = columnHasContent.indexOf(true);
  if (firstContent === -1) return null;

  const gapMin = Math.max(6, Math.round(height * 0.08));
  let gapStart = -1;
  let emptyRun = 0;
  for (let x = firstContent; x < width; x++) {
    if (columnHasContent[x]) {
      emptyRun = 0;
    } else {
      emptyRun++;
      if (emptyRun >= gapMin) {
        gapStart = x - emptyRun + 1;
        break;
      }
    }
  }
  if (gapStart === -1) return null;

  const iconWidth = gapStart - firstContent;
  if (iconWidth < height * 0.4) return null; // too thin to be a standalone mark

  const side = height;
  const centerX = firstContent + iconWidth / 2;
  const left = Math.max(0, Math.min(Math.round(centerX - side / 2), width - side));

  return sharp(buffer).extract({ left, top: 0, width: side, height: side }).toFormat(format).toBuffer();
}
