import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { hash } from "bcryptjs";
import { createHash } from "crypto";
import { rateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  try {
    // Throttle token guessing.
    const rl = await rateLimit(`reset:${clientIp(req)}`, { max: 10, windowSec: 900 });
    if (!rl.ok) {
      return NextResponse.json({ error: "Demasiados intentos. Inténtalo más tarde." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } });
    }

    const { token, password } = await req.json() as { token?: string; password?: string };

    if (!token || !password) {
      return NextResponse.json({ error: "Token y contraseña requeridos" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    // Look up by the token's hash (raw token is never stored).
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const user = await db.query.orgUsers.findFirst({
      where: and(
        eq(orgUsers.resetToken, tokenHash),
        isNotNull(orgUsers.resetTokenExpiresAt),
        gt(orgUsers.resetTokenExpiresAt, new Date()),
      ),
    });

    if (!user) {
      return NextResponse.json({ error: "Token inválido o expirado" }, { status: 400 });
    }

    const passwordHash = await hash(password, 12);

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

    await logAudit({
      orgId: user.organizationId, userId: user.id, userEmail: user.email,
      action: "password.reset", resourceType: "user", resourceId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
