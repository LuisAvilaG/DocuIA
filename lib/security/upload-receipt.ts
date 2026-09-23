import { createHmac, timingSafeEqual } from "node:crypto";
import { jwtSecret } from "@/lib/env";
import { z } from "zod";

const schema = z.object({ orgId: z.string(), userId: z.string(), fileKey: z.string(), mimeType: z.string(), originalName: z.string(), expires: z.number() });
type Receipt = z.infer<typeof schema>;
function signature(payload: string): Buffer {
  return createHmac("sha256", jwtSecret()).update(`expense-upload:${payload}`).digest();
}
export function signUploadReceipt(receipt: Omit<Receipt, "expires">): string {
  const payload = Buffer.from(JSON.stringify({ ...receipt, expires: Date.now() + 24 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyUploadReceipt(raw: unknown, orgId: string, userId: string, fileKey: unknown): Receipt | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const [payload, mac, extra] = raw.split(".");
    if (!payload || !mac || extra) return null;
    const supplied = Buffer.from(mac, "base64url"), expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = schema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return parsed.orgId === orgId && parsed.userId === userId && parsed.fileKey === fileKey && parsed.expires > Date.now() ? parsed : null;
  } catch { return null; }
}
