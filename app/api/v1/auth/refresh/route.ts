import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken, isOrganizationActive } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { authSessions, orgUsers } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { getTenantHomePath } from "@/lib/products";

async function handlePOST(req: NextRequest) {
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
      where: and(eq(authSessions.id, sessionId), eq(authSessions.userId, sub), eq(authSessions.userType, type), isNull(authSessions.revokedAt)),
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
    if (session.organizationId !== user.organizationId || !await isOrganizationActive(user.organizationId)) {
      return NextResponse.json({ error: "Organización inactiva" }, { status: 401 });
    }
    if (!await isTenantIpAllowed(user.organizationId, req.headers)) {
      return NextResponse.json({ error: "Acceso restringido por IP" }, { status: 403 });
    }

    const newNonce     = randomBytes(32).toString("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const homePath     = await getTenantHomePath(user.organizationId);

    const rotated = await db
      .update(authSessions)
      .set({ refreshToken: newNonce, expiresAt: newExpiresAt })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.refreshToken, tokenNonce), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
      .returning({ id: authSessions.id });
    if (rotated.length !== 1) return NextResponse.json({ error: "Token ya utilizado" }, { status: 401 });

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken({ sessionId,
        sub:   user.id,
        type:  "org_user",
        orgId: user.organizationId,
        role:  user.role,
        email: user.email,
        homePath,
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

export const POST = withApiSecurity(handlePOST);
