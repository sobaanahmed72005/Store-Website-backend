import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// Product images and payment-proof screenshots default to local disk (see middleware/upload.js)
// so the app works out of the box with zero setup — but a file written to one server's local
// disk is invisible to every other instance, which is exactly what breaks the moment this app is
// horizontally scaled. Setting S3_BUCKET (+ credentials) switches every upload to this
// S3-compatible client instead — Cloudflare R2, AWS S3, or anything else that speaks the S3 API,
// just by pointing S3_ENDPOINT at it (leave unset for real AWS S3).
const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL } = process.env;

export const isObjectStorageConfigured = Boolean(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);

let client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: S3_REGION || 'auto',
      endpoint: S3_ENDPOINT || undefined,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export async function putObject(key, buffer, contentType) {
  await getClient().send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
}

export async function objectExists(key) {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectBuffer(key) {
  const res = await getClient().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Public product/branding images are meant to be served straight from the bucket/CDN, not
// proxied back through this Node process — S3_PUBLIC_URL is the bucket's public base URL (an R2
// public bucket URL, a CloudFront/CDN domain in front of S3, etc).
export function publicUrlFor(key) {
  if (!S3_PUBLIC_URL) {
    throw new Error('S3_PUBLIC_URL must be set (to the bucket\'s public base URL) when S3_BUCKET is configured');
  }
  return `${S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}
