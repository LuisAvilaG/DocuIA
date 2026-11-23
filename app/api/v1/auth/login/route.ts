import { clientIp } from "@/lib/security/request-ip";
import { loginSchema, accountRateKey } from "@/lib/auth/input";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers, authSessions, organizations } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { orgBlockMessage } from "@/lib/auth/org-block";
import { compare } from "bcryptjs";
import { v4 as uuid } from "uuid";
import { randomBytes } from "crypto";
import { signAccessToken, signRefreshToken, isOrganizationActive } from "@/lib/auth/jwt";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";
import { getTenantHomePath } from "@/lib/products";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { SESSION_TTL_MS, setAuthCookies } from "@/lib/auth/cookies";

// A bcrypt hash (cost 12) of a value nobody knows.
const NO_ACCOUNT_HASH = "$2b$12$J3nnYPM3D/61r8ks0/BDB.a1gmXgVm.IH51uZv1Crd/8Lj0QBkgnO";

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
    const accountKey = accountRateKey("tenant-login", `${email}|${ip}`);
    const accountLimit = await rateLimit(accountKey, { max: 5, windowSec: 900 });
    if (!accountLimit.ok) return NextResponse.json({ error: "Demasiados intentos" }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSec ?? 900) } });

    // The address is compared without case: the form lowercases what is typed,
    // and an account stored as "Ana@Empresa.com" could never sign in.
    const user = await db.query.orgUsers.findFirst({
      where: eq(sql`lower(${orgUsers.email})`, email),
    });

    if (!user || !user.passwordHash) {
      // The same hash work as a wrong password, so the response time does not
      // tell which emails have an account.
      await compare(password, NO_ACCOUNT_HASH);
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    await clearRateLimit(accountKey);

    // The password is right, so the real reason can be said: answering
    // "credenciales inválidas" to a deactivated user, or to one whose company is
    // suspended or past its trial, sent people to reset a password that was fine.
    if (!user.isActive) {
      return NextResponse.json({ error: "Tu usuario está desactivado. Pide a un administrador de tu empresa que lo reactive." }, { status: 403 });
    }
    if (!await isOrganizationActive(user.organizationId)) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
        columns: { status: true, trialEndsAt: true, deletedAt: true },
      });
      return NextResponse.json({ error: orgBlockMessage(org) ?? "La cuenta de tu empresa no está activa. Contacta a DocuIA." }, { status: 403 });
    }

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
