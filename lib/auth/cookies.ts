import type { NextResponse } from "next/server";

// Server-side sessions (auth_sessions.expiresAt) and refresh tokens last 7 days.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

export const AUTH_COOKIES = {
  tenant: { access: "access_token", refresh: "refresh_token" },
  admin: { access: "admin_access_token", refresh: "admin_refresh_token" },
} as const;

export type AuthRealm = keyof typeof AUTH_COOKIES;

// The access JWT is short-lived (JWT_EXPIRES_IN), but its cookie deliberately
// outlives it. The proxy needs to *see* the expired token to tell "session can
// be renewed" apart from "never logged in"; a cookie that vanished together
// with the JWT sent idle users to a blank login form despite a valid refresh.
export function setAuthCookies(res: NextResponse, realm: AuthRealm, accessToken: string, refreshToken: string) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_SEC,
    path: "/",
  };
  res.cookies.set(AUTH_COOKIES[realm].access, accessToken, options);
  res.cookies.set(AUTH_COOKIES[realm].refresh, refreshToken, options);
}

export function clearAuthCookies(res: NextResponse, realm: AuthRealm) {
  res.cookies.delete(AUTH_COOKIES[realm].access);
  res.cookies.delete(AUTH_COOKIES[realm].refresh);
}
