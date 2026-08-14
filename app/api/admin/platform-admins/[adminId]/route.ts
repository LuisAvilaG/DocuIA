import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { authSessions, platformAdmins } from "@/db/schema";

type Params = { params: Promise<{ adminId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { adminId } = await params;
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;

    const target = await db.query.platformAdmins.findFirst({
      where: eq(platformAdmins.id, adminId),
    });
    if (!target) {
      return NextResponse.json({ error: "Administrador no encontrado" }, { status: 404 });
    }

    const updates: {
      updatedAt: Date;
      fullName?: string | null;
      isActive?: boolean;
      passwordHash?: string;
    } = { updatedAt: new Date() };
    let changed = false;
    let revokeSessions = false;

    if (typeof fields.fullName === "string") {
      updates.fullName = fields.fullName.trim().slice(0, 255) || null;
      changed = true;
    }

    if (typeof fields.password === "string") {
      if (fields.password.length < 12) {
        return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres" }, { status: 400 });
      }
      updates.passwordHash = hashSync(fields.password, 12);
      revokeSessions = true;
      changed = true;
    }

    if (typeof fields.isActive === "boolean" && fields.isActive !== target.isActive) {
      if (!fields.isActive) {
        if (adminId === session!.sub) {
          return NextResponse.json({ error: "No puedes desactivar tu propia cuenta" }, { status: 400 });
        }
        const [activeCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(platformAdmins)
          .where(eq(platformAdmins.isActive, true));
        if (Number(activeCount?.count ?? 0) <= 1) {
          return NextResponse.json({ error: "Debe permanecer al menos un administrador activo" }, { status: 400 });
        }
        revokeSessions = true;
      }
      updates.isActive = fields.isActive;
      changed = true;
    }

    if (!changed) {
      return NextResponse.json({ error: "No hay cambios para guardar" }, { status: 400 });
    }

    const [admin] = await db
      .update(platformAdmins)
      .set(updates)
      .where(eq(platformAdmins.id, adminId))
      .returning();

    if (revokeSessions) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(authSessions.userId, adminId),
          eq(authSessions.userType, "platform_admin"),
          isNull(authSessions.revokedAt),
        ));
    }

    return NextResponse.json({
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        isActive: admin.isActive,
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      },
      reauthenticate: revokeSessions && adminId === session!.sub,
    });
  } catch (err) {
    console.error("[platform-admins PATCH]", err);
    return NextResponse.json({ error: "No se pudo actualizar el administrador" }, { status: 500 });
  }
}
