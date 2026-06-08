import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { authSessions, platformAdmins } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get("admin_refresh_token")?.value;
  if (!refreshCookie) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const payload = await verifyRefreshToken(refreshCookie);
    const { sub, type, sessionId, tokenNonce } = payload;

    if (type !== "platform_admin") {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const session = await db.query.authSessions.findFirst({
      where: and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)),
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
    }

    if (session.refreshToken !== tokenNonce) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, sub), eq(authSessions.userType, "platform_admin")));
      return NextResponse.json(
        { error: "Sesión inválida. Inicia sesión nuevamente." },
        { status: 401 }
      );
    }

    const admin = await db.query.platformAdmins.findFirst({ where: eq(platformAdmins.id, sub) });
    if (!admin || !admin.isActive) {
      return NextResponse.json({ error: "Admin inactivo" }, { status: 401 });
    }

    const newNonce     = randomBytes(32).toString("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(authSessions)
      .set({ refreshToken: newNonce, expiresAt: newExpiresAt })
      .where(eq(authSessions.id, sessionId));

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken({ sub: admin.id, type: "platform_admin", email: admin.email }),
      signRefreshToken({ sub: admin.id, type: "platform_admin", sessionId, tokenNonce: newNonce }),
    ]);

    const res    = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set("admin_access_token", accessToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 8, path: "/",
    });
    res.cookies.set("admin_refresh_token", newRefreshToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
    });

    return res;
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
}
