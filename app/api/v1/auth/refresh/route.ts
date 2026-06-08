import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { authSessions, orgUsers } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get("refresh_token")?.value;
  if (!refreshCookie) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const payload = await verifyRefreshToken(refreshCookie);
    const { sub, type, sessionId, tokenNonce } = payload;

    if (type !== "org_user") {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const session = await db.query.authSessions.findFirst({
      where: and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)),
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
    }

    // Token reuse detection — if nonces don't match, a refresh token was reused
    if (session.refreshToken !== tokenNonce) {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, sub), eq(authSessions.userType, "org_user")));
      return NextResponse.json(
        { error: "Sesión inválida. Inicia sesión nuevamente." },
        { status: 401 }
      );
    }

    const user = await db.query.orgUsers.findFirst({ where: eq(orgUsers.id, sub) });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Usuario inactivo" }, { status: 401 });
    }

    const newNonce     = randomBytes(32).toString("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(authSessions)
      .set({ refreshToken: newNonce, expiresAt: newExpiresAt })
      .where(eq(authSessions.id, sessionId));

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken({
        sub:   user.id,
        type:  "org_user",
        orgId: user.organizationId,
        role:  user.role,
        email: user.email,
      }),
      signRefreshToken({ sub: user.id, type: "org_user", sessionId, tokenNonce: newNonce }),
    ]);

    const res    = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set("access_token", accessToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 15, path: "/",
    });
    res.cookies.set("refresh_token", newRefreshToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
    });

    return res;
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
}
