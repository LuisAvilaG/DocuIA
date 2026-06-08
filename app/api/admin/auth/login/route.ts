import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformAdmins, authSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { randomUUID, randomBytes } from "crypto";
import { addDays } from "date-fns";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const rl = rateLimit(ip, { max: 5, windowSec: 900 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Inténtalo en ${Math.ceil((rl.retryAfterSec ?? 900) / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email y contraseña son requeridos" }, { status: 400 });
    }

    const admin = await db.query.platformAdmins.findFirst({
      where: eq(platformAdmins.email, email.toLowerCase().trim()),
    });

    if (!admin || !admin.isActive) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const valid = await compare(password, admin.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    clearRateLimit(ip);

    const sessionId  = randomUUID();
    const tokenNonce = randomBytes(32).toString("hex");

    await db.insert(authSessions).values({
      id:           sessionId,
      userId:       admin.id,
      userType:     "platform_admin",
      refreshToken: tokenNonce,
      ipAddress:    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
      userAgent:    req.headers.get("user-agent") ?? null,
      expiresAt:    addDays(new Date(), 7),
    });

    await db.update(platformAdmins)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformAdmins.id, admin.id));

    const accessToken = await signAccessToken({
      sub:   admin.id,
      type:  "platform_admin",
      email: admin.email,
    });

    const refreshTokenSigned = await signRefreshToken({
      sub:        admin.id,
      type:       "platform_admin",
      sessionId,
      tokenNonce,
    });

    const res    = NextResponse.json({ ok: true });
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set("admin_access_token", accessToken, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 8, path: "/",
    });
    res.cookies.set("admin_refresh_token", refreshTokenSigned, {
      httpOnly: true, secure, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/",
    });

    return res;
  } catch (err) {
    console.error("[admin/login]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
