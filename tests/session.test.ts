import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "../proxy";
import { safeAdminReturnPath, safeReturnPath } from "../lib/security/return-path";
import { setAuthCookies, SESSION_TTL_MS } from "../lib/auth/cookies";

process.env.JWT_SECRET = "test-only-".repeat(8);
process.env.NEXT_PUBLIC_APP_URL = "https://app.example";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const base = {
  sub: "10000000-0000-4000-8000-000000000002",
  sessionId: "10000000-0000-4000-8000-000000000003",
  email: "person@example.com",
  tokenUse: "access",
};

async function token(type: "org_user" | "platform_admin", exp: string | number) {
  const claims = type === "org_user" ? { ...base, type, orgId: "10000000-0000-4000-8000-000000000001", role: "operator" } : { ...base, type };
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(exp).sign(secret);
}

function request(path: string, cookies: Record<string, string>) {
  return new NextRequest(`https://app.example${path}`, {
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  });
}

test("valid access tokens pass the proxy for each realm", async () => {
  const tenant = await proxy(request("/dashboard", { access_token: await token("org_user", "10m") }));
  assert.equal(tenant.headers.get("location"), null);
  const admin = await proxy(request("/admin/clients", { admin_access_token: await token("platform_admin", "10m") }));
  assert.equal(admin.headers.get("location"), null);
});

test("expired access with a refresh cookie restores the route instead of logging out", async () => {
  const expired = Math.floor(Date.now() / 1000) - 60;
  const tenant = await proxy(request("/contracts/flow?x=1", { access_token: await token("org_user", expired), refresh_token: "r" }));
  assert.equal(tenant.headers.get("location"), "https://app.example/login?returnTo=%2Fcontracts%2Fflow%3Fx%3D1");
  assert.doesNotMatch(tenant.headers.get("set-cookie") ?? "", /refresh_token=;/);

  const admin = await proxy(request("/admin/clients", { admin_access_token: await token("platform_admin", expired), admin_refresh_token: "r" }));
  assert.equal(admin.headers.get("location"), "https://app.example/admin/login?returnTo=%2Fadmin%2Fclients");
  assert.doesNotMatch(admin.headers.get("set-cookie") ?? "", /admin_refresh_token=;/);

  // Access cookie already gone (e.g. issued before cookies outlived the JWT).
  const missing = await proxy(request("/expenses", { refresh_token: "r" }));
  assert.equal(missing.headers.get("location"), "https://app.example/login?returnTo=%2Fexpenses");
});

test("forged or wrong-realm tokens clear both cookies", async () => {
  const forged = await proxy(request("/dashboard", { access_token: "not-a-jwt", refresh_token: "r" }));
  assert.equal(forged.headers.get("location"), "https://app.example/login");
  assert.match(forged.headers.get("set-cookie") ?? "", /refresh_token=;/);

  const crossRealm = await proxy(request("/admin", { admin_access_token: await token("org_user", "10m"), admin_refresh_token: "r" }));
  assert.equal(crossRealm.headers.get("location"), "https://app.example/admin/login");
});

test("access cookies outlive the JWT so expiry stays observable", () => {
  const res = NextResponse.json({ ok: true });
  setAuthCookies(res, "tenant", "a", "r");
  assert.equal(res.cookies.get("access_token")?.maxAge, SESSION_TTL_MS / 1000);
  assert.equal(res.cookies.get("refresh_token")?.maxAge, SESSION_TTL_MS / 1000);
});

test("admin return paths stay inside the admin area", () => {
  assert.equal(safeAdminReturnPath("/admin/clients/1?tab=users"), "/admin/clients/1?tab=users");
  assert.equal(safeAdminReturnPath("/admin"), "/admin");
  assert.equal(safeAdminReturnPath("/admin/login"), null);
  assert.equal(safeAdminReturnPath("/administrator"), null);
  assert.equal(safeAdminReturnPath("//evil.example/admin"), null);
  assert.equal(safeAdminReturnPath("/dashboard"), null);
  assert.equal(safeReturnPath("/admin/clients"), null);
});
