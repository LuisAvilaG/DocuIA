import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { compare, hash } from "bcryptjs";

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json() as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Contraseña actual y nueva son requeridas" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "La nueva contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }

  const user = await db.query.orgUsers.findFirst({
    where: and(eq(orgUsers.id, session.sub), eq(orgUsers.organizationId, session.orgId)),
    columns: { id: true, passwordHash: true },
  });
  if (!user || !user.passwordHash) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) return NextResponse.json({ error: "Contraseña actual incorrecta" }, { status: 400 });

  const newHash = await hash(newPassword, 10);
  await db.update(orgUsers)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(orgUsers.id, session.sub));

  return NextResponse.json({ ok: true });
}
