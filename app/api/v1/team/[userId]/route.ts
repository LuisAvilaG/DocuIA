import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isTenantRole } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { authSessions, orgUsers } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";

type Params = { params: Promise<{ userId: string }> };

/** Cambia nombre, rol o acceso de un usuario. Solo administradores; nunca deja la empresa sin administrador activo. */
async function handlePATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession({ area: "settings", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  const { userId } = await params;
  const body = await req.json().catch(() => ({})) as { fullName?: unknown; role?: unknown; isActive?: unknown };
  const user = await db.query.orgUsers.findFirst({
    where: and(eq(orgUsers.id, userId), eq(orgUsers.organizationId, session.orgId)),
    columns: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const changes: { fullName?: string | null; role?: typeof user.role; isActive?: boolean } = {};
  if (typeof body.fullName === "string") changes.fullName = body.fullName.trim().slice(0, 255) || null;
  if (body.role !== undefined) {
    if (!isTenantRole(body.role)) return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    if (body.role !== user.role) changes.role = body.role as typeof user.role;
  }
  if (typeof body.isActive === "boolean" && body.isActive !== user.isActive) changes.isActive = body.isActive;

  const self = user.id === session.sub;
  if (self && (changes.role !== undefined || changes.isActive === false)) {
    return NextResponse.json({ error: "No puedes cambiar tu propio rol ni desactivarte." }, { status: 400 });
  }
  const losesAdmin = user.role === "admin" && user.isActive && (changes.isActive === false || (changes.role !== undefined && changes.role !== "admin"));
  if (losesAdmin) {
    const others = await db.$count(orgUsers, and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.role, "admin"), eq(orgUsers.isActive, true), ne(orgUsers.id, user.id)));
    if (others === 0) return NextResponse.json({ error: "La empresa necesita al menos un administrador activo." }, { status: 400 });
  }
  if (Object.keys(changes).length === 0) return NextResponse.json({ ok: true, user });

  await db.transaction(async (tx) => {
    await tx.update(orgUsers).set({ ...changes, updatedAt: new Date() }).where(eq(orgUsers.id, user.id));
    // Un cambio de rol o de acceso cierra sus sesiones: entra de nuevo con los permisos nuevos.
    if (changes.role !== undefined || changes.isActive === false) {
      await tx.update(authSessions).set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, user.id), eq(authSessions.userType, "org_user")));
    }
  });
  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "team.user_updated",
    resourceType: "org_user", resourceId: user.id,
    metadata: { email: user.email, before: { role: user.role, isActive: user.isActive, fullName: user.fullName }, after: changes },
  });
  return NextResponse.json({ ok: true, user: { ...user, ...changes } });
}

export const PATCH = withApiSecurity(handlePATCH);
