import { withApiSecurity } from "@/lib/security/http";
import { logAdminAction } from "@/lib/audit/admin";
import { isTenantRole } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { passwordSchema } from "@/lib/auth/input";
import { and, eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";

type Params = { params: Promise<{ id: string; userId: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, userId } = await params;
    const body = await req.json();

    const user = await db.query.orgUsers.findFirst({
      where: and(
        eq(orgUsers.id, userId),
        eq(orgUsers.organizationId, organizationId),
      ),
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.role === "string" && isTenantRole(body.role)) {
      updates.role = body.role;
    }
    if (typeof body.isActive === "boolean") {
      updates.isActive = body.isActive;
    }
    if (typeof body.fullName === "string") {
      updates.fullName = body.fullName || null;
    }
    if (body.password !== undefined && !passwordSchema.safeParse(body.password).success) return NextResponse.json({ error: "Contraseña inválida: usa 8 a 72 bytes." }, { status: 400 });
    if (typeof body.password === "string") {
      updates.passwordHash = hashSync(body.password, 12);
      updates.resetToken = null;
      updates.resetTokenExpiresAt = null;
    }

    await db.transaction(async tx => {
      await tx.update(orgUsers).set(updates).where(eq(orgUsers.id, userId));
      if (updates.passwordHash || body.isActive === false) await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, userId), eq(authSessions.userType, "org_user")));
    });

    await logAdminAction(req, session!, {
      action: "tenant_user.updated", targetOrgId: organizationId, targetUserId: userId,
      before: { role: user.role, isActive: user.isActive },
      after: { role: updates.role ?? user.role, isActive: updates.isActive ?? user.isActive, passwordReset: Boolean(updates.passwordHash) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clients/users PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const PATCH = withApiSecurity(handlePATCH);
