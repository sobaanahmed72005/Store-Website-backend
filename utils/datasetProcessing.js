// Product "Dataset" attachments (spec sheets, datasheets, manuals) — PDF or Word. Same rationale
// as videoProcessing.js: there's no lightweight, format-preserving way to re-encode a PDF/Word
// file server-side, so this can't strip malicious bytes the way sanitizeImageBuffer does for
// images. It still verifies the file's real leading bytes match a known container format rather
// than trusting the client-supplied Content-Type header, which is trivially spoofable.
const SIGNATURES = [
  { format: 'pdf', contentType: 'application/pdf', check: (buf) => buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-' },
  // .docx is a zip (OOXML) container — same leading signature as .xlsx/.pptx, but the upload
  // route only ever labels this "dataset" is a Word doc, so that's the extension/type it's saved as.
  {
    format: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    check: (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04,
  },
  // Legacy .doc (OLE compound file) signature.
  {
    format: 'doc',
    contentType: 'application/msword',
    check: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
      buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1,
  },
];

// Takes the in-memory buffer multer already holds (uploadDataset uses the same memoryStorage as
// every other upload type — see middleware/upload.js).
export function verifyUploadedDataset(buffer) {
  const match = SIGNATURES.find((sig) => sig.check(buffer));
  if (!match) throw new Error('Unsupported or unrecognized document format');
  return match;
}
