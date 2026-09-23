import { createHash } from "node:crypto";
import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(191);
export const passwordSchema = z.string().min(8).max(72).refine(s => Buffer.byteLength(s, "utf8") <= 72);
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(1024) });
export function accountRateKey(area: string, email: string): string {
  return `${area}:account:${createHash("sha256").update(email).digest("hex")}`;
}
