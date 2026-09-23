// Uses only a disposable MinIO container, never the configured application store.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

async function main() {
  const name = `docuia-storage-test-${randomBytes(5).toString("hex")}`;
  const secret = randomBytes(24).toString("hex");
  const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
  let created = false;
  try {
    docker("run", "--rm", "-d", "--name", name, "--label", "docuia.security-test=true", "-e", "MINIO_ROOT_USER=securitytest", "-e", `MINIO_ROOT_PASSWORD=${secret}`, "-p", "127.0.0.1::9000", "minio/minio:latest", "server", "/data");
    created = true;
    const port = JSON.parse(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", name))["9000/tcp"][0].HostPort;
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Isolated MinIO must start");
    Object.assign(process.env, { MINIO_ENDPOINT: "127.0.0.1", MINIO_PORT: port, MINIO_USE_SSL: "false", MINIO_ACCESS_KEY: "securitytest", MINIO_SECRET_KEY: secret, MINIO_BUCKET: "security-test", MINIO_REGION: "us-east-1" });
    const storage = await import("../lib/storage/minio");
    const key = "tenant/folder/prueba con espacios-ñ.pdf";
    const payload = Buffer.from("%PDF-1.7\nsecurity fixture\n");
    await Promise.all([storage.ensureBucket(), storage.ensureBucket()]);
    await storage.uploadFile(payload, key, "application/pdf");
    assert.deepEqual(await storage.getFileBuffer(key), payload);
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.getFileStream(key)) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), payload);
    const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "securitytest", secretAccessKey: secret } });
    try { assert.equal((await client.send(new HeadObjectCommand({ Bucket: "security-test", Key: key }))).ContentType, "application/pdf"); } finally { client.destroy(); }
    await assert.rejects(storage.getFileBuffer(key, 2), /demasiado grande/);
    await storage.deleteFile(key);
    await assert.rejects(storage.getFileBuffer(key), { name: "NoSuchKey" });
    const checks = ["concurrent bucket creation", "upload and buffer integrity", "stream integrity", "content type", "bounded downloads", "deletion and missing object"];
    mkdirSync("output/security", { recursive: true });
    writeFileSync("output/security/storage-results.json", JSON.stringify({ checkedAt: new Date().toISOString(), isolated: true, checks, pass: true }, null, 2));
    console.log(`PASS ${checks.length} isolated MinIO checks`);
  } finally {
    if (created && docker("inspect", "--format", '{{index .Config.Labels "docuia.security-test"}}', name) === "true") docker("stop", name);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Storage test failed"); process.exitCode = 1; });
