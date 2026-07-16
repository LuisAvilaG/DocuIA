import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { jwtSecret } from "@/lib/env";

const TENANT_ROUTES = [
  "/dashboard", "/workflow", "/history", "/exceptions",
  "/mappings", "/catalogs", "/statistics", "/settings",
  "/expenses", "/accounting", "/contracts",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Admin login page ─────────────────────────────────────────
  if (pathname === "/admin/login") {
    const token = req.cookies.get("admin_access_token")?.value;
    if (token) {
      try {
        const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
        if (payload.type === "platform_admin")
          return NextResponse.redirect(new URL("/admin", req.url));
      } catch { /* invalid/expired — let through */ }
    }
    return NextResponse.next();
  }

  // ── Admin protected routes ───────────────────────────────────
  if (pathname.startsWith("/admin")) {
    const token = req.cookies.get("admin_access_token")?.value;
    if (!token) return NextResponse.redirect(new URL("/admin/login", req.url));
    try {
      const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
      if (payload.type !== "platform_admin") throw new Error();
      return NextResponse.next();
    } catch {
      const res = NextResponse.redirect(new URL("/admin/login", req.url));
      res.cookies.delete("admin_access_token");
      res.cookies.delete("admin_refresh_token");
      return res;
    }
  }

  // ── Tenant login page ────────────────────────────────────────
  if (pathname === "/login") {
    const token = req.cookies.get("access_token")?.value;
    if (token) {
      try {
        const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
        if (payload.type === "org_user")
          return NextResponse.redirect(new URL("/dashboard", req.url));
      } catch { /* let through */ }
    }
    return NextResponse.next();
  }

  // ── Tenant protected routes ──────────────────────────────────
  const isTenant = TENANT_ROUTES.some((r) => pathname.startsWith(r));
  if (isTenant) {
    const token = req.cookies.get("access_token")?.value;
    if (!token) return NextResponse.redirect(new URL("/login", req.url));
    try {
      const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
      if (payload.type !== "org_user") throw new Error();
      return NextResponse.next();
    } catch {
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
    "/login",
  ],
};
