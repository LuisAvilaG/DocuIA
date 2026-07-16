import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

// First-boot super-admin seed. Runs from instrumentation on server start:
// if PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD are set and no admin with
// that email exists, create it. Idempotent — safe to run on every boot.
export async function seedPlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await db.query.platformAdmins.findFirst({ where: eq(platformAdmins.email, email) });
  if (existing) return;

  await db.insert(platformAdmins).values({
    id:           randomUUID(),
    email,
    passwordHash: hashSync(password, 12),
    fullName:     "Platform Admin",
    isActive:     true,
  });
  console.log(`[seed-admin] super-admin creado: ${email}`);
}
