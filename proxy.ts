import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { jwtSecret } from "@/lib/env";
import { accessPayloadSchema } from "@/lib/auth/token-payload";
import { AUTH_COOKIES, clearAuthCookies, type AuthRealm } from "@/lib/auth/cookies";

const TENANT_ROUTES = [
  "/dashboard", "/workflow", "/history", "/exceptions",
  "/mappings", "/catalogs", "/statistics", "/settings",
  "/expenses", "/accounting", "/contracts",
  "/cases",
];

function isExpiredJwt(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_JWT_EXPIRED";
}

const REALMS = {
  admin: { loginPath: "/admin/login", tokenType: "platform_admin" },
  tenant: { loginPath: "/login", tokenType: "org_user" },
} as const;

// Signature/claims check only; the data layer validates the live session.
async function guard(req: NextRequest, realm: AuthRealm): Promise<NextResponse> {
  const { loginPath, tokenType } = REALMS[realm];
  const token = req.cookies.get(AUTH_COOKIES[realm].access)?.value;
  let expired = !token;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
      if (accessPayloadSchema.safeParse(payload).success && payload.type === tokenType) return NextResponse.next();
    } catch (error) {
      expired = isExpiredJwt(error);
    }
  }

  // A missing or expired access token can still be renewed through the
  // rotating refresh token. Keep that cookie and let the login page restore
  // the exact route instead of forcing the person to sign in again.
  const loginUrl = new URL(loginPath, req.url);
  if (expired && req.cookies.get(AUTH_COOKIES[realm].refresh)?.value) {
    loginUrl.searchParams.set("returnTo", `${req.nextUrl.pathname}${req.nextUrl.search}`);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(AUTH_COOKIES[realm].access);
    return res;
  }
  const res = NextResponse.redirect(loginUrl);
  clearAuthCookies(res, realm);
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login must remain reachable after a server-side revocation. The data layer
  // validates active sessions; a signed cookie alone cannot redirect from login.
  if (pathname === "/admin/login" || pathname === "/login") return NextResponse.next();

  if (pathname.startsWith("/admin")) return guard(req, "admin");
  if (TENANT_ROUTES.some((r) => pathname.startsWith(r))) return guard(req, "tenant");
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    "/workflow/:path*",
    "/history/:path*",
    "/exceptions/:path*",
    "/mappings/:path*",
    "/catalogs/:path*",
    "/statistics/:path*",
    "/settings/:path*",
    "/expenses/:path*",
    "/accounting/:path*",
    "/contracts/:path*",
    "/cases/:path*",
    "/login",
  ],
};
