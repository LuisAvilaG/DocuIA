import { clientIp } from "@/lib/security/request-ip";
import { loginSchema, accountRateKey } from "@/lib/auth/input";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { v4 as uuid } from "uuid";
import { randomBytes } from "crypto";
import { signAccessToken, signRefreshToken, isOrganizationActive } from "@/lib/auth/jwt";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";
import { getTenantHomePath } from "@/lib/products";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { SESSION_TTL_MS, setAuthCookies } from "@/lib/auth/cookies";

async function handlePOST(req: NextRequest) {
  const ip = clientIp(req.headers);

  const rl = await rateLimit(`tenant-login:ip:${ip}`, { max: 30, windowSec: 900 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Inténtalo en ${Math.ceil((rl.retryAfterSec ?? 900) / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const parsed = loginSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
    }
    const { email, password } = parsed.data;
    const accountKey = accountRateKey("tenant-login", email);
    const accountLimit = await rateLimit(accountKey, { max: 5, windowSec: 900 });
    if (!accountLimit.ok) return NextResponse.json({ error: "Demasiados intentos" }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSec ?? 900) } });

    const user = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, email),
    });

    if (!user || !user.passwordHash || !user.isActive || !await isOrganizationActive(user.organizationId)) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    await clearRateLimit(accountKey);

    // Checked after the password so the response does not reveal which
    // accounts exist, but before a session is issued: a session from a blocked
    // network would only bounce between the login form and the portal.
    if (!await isTenantIpAllowed(user.organizationId, req.headers)) {
      return NextResponse.json({ error: "Tu dirección IP no tiene permiso para acceder a este portal. Contacta al administrador." }, { status: 403 });
    }

    const homePath = await getTenantHomePath(user.organizationId);

    const sessionId  = uuid();
    const tokenNonce = randomBytes(32).toString("hex");
    const expiresAt  = new Date(Date.now() + SESSION_TTL_MS);

    await db.update(orgUsers).set({ lastLoginAt: new Date() }).where(eq(orgUsers.id, user.id));

    await db.insert(authSessions).values({
      id:             sessionId,
      userId:         user.id,
      userType:       "org_user",
      organizationId: user.organizationId,
      refreshToken:   tokenNonce,
      expiresAt,
      ipAddress:      ip,
      userAgent:      req.headers.get("user-agent") ?? null,
    });

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ sessionId,
        sub:   user.id,
        type:  "org_user",
        orgId: user.organizationId,
        role:  user.role,
        email: user.email,
        homePath,
      }),
      signRefreshToken({ sub: user.id, type: "org_user", sessionId, tokenNonce }),
    ]);

    // fire-and-forget audit log
    logAudit({
      orgId:     user.organizationId,
      userId:    user.id,
      userEmail: user.email,
      action:    "login",
      ipAddress: ip,
    });

    const res = NextResponse.json({ ok: true, homePath });
    setAuthCookies(res, "tenant", accessToken, refreshToken);
    return res;
  } catch (err) {
    console.error("[tenant-login]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export const POST = withApiSecurity(handlePOST);
