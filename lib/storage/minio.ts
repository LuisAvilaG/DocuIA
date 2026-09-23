import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { BucketLocationConstraint } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    // No insecure "minioadmin" default — fail fast on a misconfigured deploy
    // rather than silently exposing the bucket with well-known credentials.
    if (!accessKey || !secretKey) {
      throw new Error("MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set");
    }
    _client = new S3Client({
      endpoint: `${process.env.MINIO_USE_SSL === "true" ? "https" : "http"}://${process.env.MINIO_ENDPOINT || "localhost"}:${Number(process.env.MINIO_PORT || 9000)}`,
      region: process.env.MINIO_REGION || "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
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
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    if (!(error instanceof Error) || !("$metadata" in error) || (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 404) throw error;
    try {
      const region = process.env.MINIO_REGION || "us-east-1";
      // MinIO also accepts custom region names beyond AWS's generated enum.
      await client.send(new CreateBucketCommand({ Bucket: BUCKET, ...(region !== "us-east-1" ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } } : {}) }));
    } catch (createError) {
      if (!(createError instanceof Error) || createError.name !== "BucketAlreadyOwnedByYou") throw createError;
    }
  }
  bucketReady = true;
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<void> {
  await ensureBucket();
  await getClient().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentLength: buffer.length, ContentType: mimeType }));
}

export async function getFileBuffer(key: string, maxBytes = 60 * 1024 * 1024): Promise<Buffer> {
  const stream = await getFileStream(key);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) { stream.destroy(new Error("Archivo almacenado demasiado grande")); return; }
      chunks.push(buffer);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// Raw object stream — lets callers pipe straight to an HTTP response instead of
// buffering the whole file (e.g. a 20 MB PDF) into memory.
export async function getFileStream(key: string): Promise<Readable> {
  const result = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!(result.Body instanceof Readable)) throw new Error("Respuesta de almacenamiento inválida");
  return result.Body;
}

export async function deleteFile(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
