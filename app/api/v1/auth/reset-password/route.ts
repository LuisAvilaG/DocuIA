import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { hash } from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json() as { token?: string; password?: string };

    if (!token || !password) {
      return NextResponse.json({ error: "Token y contraseña requeridos" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const user = await db.query.orgUsers.findFirst({
      where: and(
        eq(orgUsers.resetToken, token),
        isNotNull(orgUsers.resetTokenExpiresAt),
        gt(orgUsers.resetTokenExpiresAt, new Date()),
      ),
    });

    if (!user) {
      return NextResponse.json({ error: "Token inválido o expirado" }, { status: 400 });
    }

    const passwordHash = await hash(password, 10);

    await db
      .update(orgUsers)
      .set({
        passwordHash,
        resetToken:          null,
        resetTokenExpiresAt: null,
        updatedAt:           new Date(),
      })
      .where(eq(orgUsers.id, user.id));

    // Revoke all active sessions for security
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, user.id), eq(authSessions.userType, "org_user")));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
