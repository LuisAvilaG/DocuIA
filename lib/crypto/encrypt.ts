import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const ENC_PREFIX = "enc:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function decodeBase64(value: string, expectedLength?: number): Buffer {
  // Buffer.from tolerates malformed Base64. Reject it before crypto sees it so
  // stored ciphertext always has the exact AEAD framing we issued.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid encrypted field format");
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error("Invalid encrypted field format");
  }
  return decoded;
}

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string. Generate with: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
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
  const iv = decodeBase64(ivB64, IV_LENGTH);
  const authTag = decodeBase64(authTagB64, AUTH_TAG_LENGTH);
  const data = decodeBase64(dataB64);
  // Node otherwise permits variable-length GCM tags. This application always
  // emits 128-bit tags, so require that size when accepting stored ciphertext.
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
