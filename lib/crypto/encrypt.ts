import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const ENC_PREFIX = "enc:";

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string. Generate with: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encoded = [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
  return ENC_PREFIX + encoded;
}

export function decryptField(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value; // backward compat with plaintext
  const encoded = value.slice(ENC_PREFIX.length);
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted field format");
  const [ivB64, authTagB64, dataB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
