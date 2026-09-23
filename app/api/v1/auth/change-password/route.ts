import { withApiSecurity } from "@/lib/security/http";
import { passwordSchema } from "@/lib/auth/input";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { compare, hash } from "bcryptjs";
import { rateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "profile", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Throttle current-password guessing (keyed by the authenticated user).
  const rl = await rateLimit(`changepw:${session.sub}`, { max: 10, windowSec: 900 });
  if (!rl.ok) {
    return NextResponse.json({ error: "Demasiados intentos. Inténtalo más tarde." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } });
  }

  const { currentPassword, newPassword } = await req.json() as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (typeof currentPassword !== "string" || currentPassword.length > 1024 || !passwordSchema.safeParse(newPassword).success) {
    return NextResponse.json({ error: "Contraseña actual y nueva son requeridas" }, { status: 400 });
  }

  const user = await db.query.orgUsers.findFirst({
    where: and(eq(orgUsers.id, session.sub), eq(orgUsers.organizationId, session.orgId)),
    columns: { id: true, passwordHash: true },
  });
  if (!user || !user.passwordHash) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) return NextResponse.json({ error: "Contraseña actual incorrecta" }, { status: 400 });

  const newHash = await hash(newPassword!, 12);
  const changed = await db.transaction(async tx => {
  const updated = await tx.update(orgUsers)
    .set({ passwordHash: newHash, resetToken: null, resetTokenExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(orgUsers.id, session.sub), eq(orgUsers.passwordHash, user.passwordHash!)))
    .returning({ id: orgUsers.id });
  if (!updated.length) return false;

  // Revoke all other sessions so a stolen session can't survive the change.
  await tx.update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, session.sub), eq(authSessions.userType, "org_user")));
  return true;
  });
  if (!changed) return NextResponse.json({ error: "La contraseña cambió. Inicia sesión nuevamente." }, { status: 409 });

  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email,
    action: "password.changed", resourceType: "user", resourceId: session.sub,
  });

  return NextResponse.json({ ok: true });
}

export const POST = withApiSecurity(handlePOST);
