import "./_load-env"; // must be first: loads .env.local before lib/db reads env
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";

async function main() {
  // Both are required: a default account and a default password published in
  // the repository would leave the platform admin open to anyone who read it.
  const [email, password, ...flags] = process.argv.slice(2);
  if (!email || !password || password.length < 12) {
    console.error("Uso: npx tsx scripts/reset-admin-password.ts <correo> <contraseña de 12 o más caracteres> [--reactivar]");
    process.exit(1);
  }

  const hash = hashSync(password, 12);
  const updated = await db.update(platformAdmins)
    // An account that was deactivated on purpose stays so unless asked.
    .set({ passwordHash: hash, ...(flags.includes("--reactivar") ? { isActive: true } : {}) })
    .where(eq(platformAdmins.email, email.toLowerCase()))
    .returning({ id: platformAdmins.id });
  if (!updated.length) {
    console.error(`No existe un administrador con el correo ${email}; no se cambió nada.`);
    process.exit(1);
  }

  console.log(`✓ Contraseña actualizada para ${email}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
