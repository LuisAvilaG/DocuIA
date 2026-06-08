import { Client } from "minio";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    });
  }
  return _client;
}

const BUCKET = process.env.MINIO_BUCKET || "docuia";

export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(BUCKET);
  if (!exists) {
    await client.makeBucket(BUCKET);
  }
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

export async function deleteFile(key: string): Promise<void> {
  await getClient().removeObject(BUCKET, key);
}
