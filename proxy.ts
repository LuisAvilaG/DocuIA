import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { jwtSecret } from "@/lib/env";
import { accessPayloadSchema } from "@/lib/auth/token-payload";

const TENANT_ROUTES = [
  "/dashboard", "/workflow", "/history", "/exceptions",
  "/mappings", "/catalogs", "/statistics", "/settings",
  "/expenses", "/accounting", "/contracts",
  "/cases",
];

function isExpiredJwt(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_JWT_EXPIRED";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login must remain reachable after a server-side revocation. The data layer
  // validates active sessions; a signed cookie alone cannot redirect from login.
  if (pathname === "/admin/login" || pathname === "/login") return NextResponse.next();

  // ── Admin protected routes ───────────────────────────────────
  if (pathname.startsWith("/admin")) {
    const token = req.cookies.get("admin_access_token")?.value;
    if (!token) return NextResponse.redirect(new URL("/admin/login", req.url));
    try {
      const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
      if (!accessPayloadSchema.safeParse(payload).success || payload.type !== "platform_admin") throw new Error();
      return NextResponse.next();
    } catch {
      const res = NextResponse.redirect(new URL("/admin/login", req.url));
      res.cookies.delete("admin_access_token");
      res.cookies.delete("admin_refresh_token");
      return res;
    }
  }

  // ── Tenant protected routes ──────────────────────────────────
  const isTenant = TENANT_ROUTES.some((r) => pathname.startsWith(r));
  if (isTenant) {
    const token = req.cookies.get("access_token")?.value;
    if (!token) return NextResponse.redirect(new URL("/login", req.url));
    try {
      const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
      if (!accessPayloadSchema.safeParse(payload).success || payload.type !== "org_user") throw new Error();
      return NextResponse.next();
    } catch (error) {
      // An expired access token can still be renewed through the rotating
      // refresh token. Preserve that cookie and let /login restore the exact
      // protected route instead of forcing the person to sign in again.
      if (isExpiredJwt(error) && req.cookies.get("refresh_token")?.value) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("returnTo", `${pathname}${req.nextUrl.search}`);
        const res = NextResponse.redirect(loginUrl);
        res.cookies.delete("access_token");
        return res;
      }
      const res = NextResponse.redirect(new URL("/login", req.url));
      res.cookies.delete("access_token");
      res.cookies.delete("refresh_token");
      return res;
    }
  }

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
