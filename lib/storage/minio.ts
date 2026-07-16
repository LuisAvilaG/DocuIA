import { Client } from "minio";
import type { Readable } from "node:stream";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    // No insecure "minioadmin" default — fail fast on a misconfigured deploy
    // rather than silently exposing the bucket with well-known credentials.
    if (!accessKey || !secretKey) {
      throw new Error("MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set");
    }
    _client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey,
      secretKey,
    });
  }
  return _client;
}

const BUCKET = process.env.MINIO_BUCKET || "docuia";

// Cache the "bucket exists" check so we don't hit MinIO on every single upload.
let bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const client = getClient();
  const exists = await client.bucketExists(BUCKET);
  if (!exists) {
    await client.makeBucket(BUCKET);
  }
  bucketReady = true;
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<void> {
  await ensureBucket();
  await getClient().putObject(BUCKET, key, buffer, buffer.length, {
    "Content-Type": mimeType,
  });
}

export async function getFileBuffer(key: string): Promise<Buffer> {
  const stream = await getClient().getObject(BUCKET, key);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// Raw object stream — lets callers pipe straight to an HTTP response instead of
// buffering the whole file (e.g. a 20 MB PDF) into memory.
export async function getFileStream(key: string): Promise<Readable> {
  return getClient().getObject(BUCKET, key);
}

export async function deleteFile(key: string): Promise<void> {
  await getClient().removeObject(BUCKET, key);
}
