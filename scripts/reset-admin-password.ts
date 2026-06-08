import "dotenv/config";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";

async function main() {
  const email    = process.argv[2] ?? "admin@docuia.com";
  const password = process.argv[3] ?? "DocuIA2024!";

  const hash = hashSync(password, 12);
  await db.update(platformAdmins)
    .set({ passwordHash: hash, isActive: true })
    .where(eq(platformAdmins.email, email.toLowerCase()));

  console.log(`✓ Contraseña actualizada para ${email}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
