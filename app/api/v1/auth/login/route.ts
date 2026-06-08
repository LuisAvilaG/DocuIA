import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers, authSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { v4 as uuid } from "uuid";
import { randomBytes } from "crypto";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Inténtalo en ${Math.ceil((rl.retryAfterSec ?? 900) / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = await req.json();
    const email    = String(body.email ?? "").toLowerCase().trim();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
    }

    const user = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, email),
    });

    if (!user || !user.passwordHash || !user.isActive) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    clearRateLimit(ip);

    const sessionId  = uuid();
    const tokenNonce = randomBytes(32).toString("hex");
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
      signAccessToken({
        sub:   user.id,
        type:  "org_user",
        orgId: user.organizationId,
        role:  user.role,
        email: user.email,
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

    const res    = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set("access_token", accessToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 15, path: "/",
    });
    res.cookies.set("refresh_token", refreshToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
    });

    return res;
  } catch (err) {
    console.error("[tenant-login]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
