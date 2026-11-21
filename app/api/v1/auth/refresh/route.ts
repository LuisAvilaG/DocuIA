import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken, signAccessToken, signRefreshToken, isOrganizationActive } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { authSessions, orgUsers } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { getTenantHomePath } from "@/lib/products";
import { SESSION_TTL_MS, setAuthCookies } from "@/lib/auth/cookies";

const REFRESH_RACE_MS = 10_000;

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

    // Two tabs (or a restored browser) refresh with the same cookie at the same
    // moment: one rotates the token and the other arrives with the previous one.
    // Right after a rotation that is a race, not a theft. The browser already
    // has the new cookies from the request that won, so nothing is issued here.
    const rotatedAgoMs = Date.now() - (session.expiresAt.getTime() - SESSION_TTL_MS);
    if (session.refreshToken !== tokenNonce && rotatedAgoMs >= 0 && rotatedAgoMs < REFRESH_RACE_MS) {
      return NextResponse.json({ ok: true });
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
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const homePath     = await getTenantHomePath(user.organizationId);

    const rotated = await db
      .update(authSessions)
      .set({ refreshToken: newNonce, expiresAt: newExpiresAt })
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.refreshToken, tokenNonce), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
      .returning({ id: authSessions.id });
    // Lost the race to a concurrent refresh of this same token: that one set the cookies.
    if (rotated.length !== 1) return NextResponse.json({ ok: true });

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

    const res = NextResponse.json({ ok: true });
    setAuthCookies(res, "tenant", accessToken, newRefreshToken);
    return res;
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
}

export const POST = withApiSecurity(handlePOST);
