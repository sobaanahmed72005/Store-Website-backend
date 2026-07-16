// Unlike images, there's no lightweight way to re-encode video server-side (would need an
// ffmpeg dependency), so this can't strip malicious bytes the way sanitizeImageBuffer does.
// It still verifies the file's real leading bytes match a known container format rather than
// trusting the client-supplied Content-Type header, which is trivially spoofable.
const SIGNATURES = [
  { format: 'mp4', check: (buf) => buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp' },
  { format: 'webm', check: (buf) => buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 },
];

// Takes the in-memory buffer multer already holds (uploadVideo uses the same memoryStorage as
// every other upload type — see middleware/upload.js) rather than reading from disk.
export function verifyUploadedVideo(buffer) {
  const match = SIGNATURES.find((sig) => sig.check(buffer));
  if (!match) throw new Error('Unsupported or unrecognized video format');
  return match.format;
}
