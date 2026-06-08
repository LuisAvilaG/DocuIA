/**
 * Creates the first platform admin account.
 * Run: npx tsx scripts/create-admin.ts
 *
 * Uses PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD from .env.local
 * or prompts for them via argv.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

async function main() {
  const email    = process.argv[2] ?? process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.argv[3] ?? process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <password>");
    console.error("Or set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env.local");
    process.exit(1);
  }

  const existing = await db.query.platformAdmins.findFirst({
    where: eq(platformAdmins.email, email.toLowerCase()),
  });

  if (existing) {
    console.log(`Admin already exists: ${email}`);
    process.exit(0);
  }

  const passwordHash = hashSync(password, 12);

  await db.insert(platformAdmins).values({
    id:           randomUUID(),
    email:        email.toLowerCase(),
    passwordHash,
    fullName:     "Platform Admin",
    isActive:     true,
  });

  console.log(`✓ Admin created: ${email}`);
  console.log(`  Now run: npm run dev`);
  console.log(`  Login at: http://localhost:3000/admin/login`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
