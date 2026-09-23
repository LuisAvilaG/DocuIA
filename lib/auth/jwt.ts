import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { jwtSecret, refreshSecret } from "@/lib/env";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { db } from "@/lib/db";
import { apiKeys, authSessions, orgUsers, organizations, platformAdmins } from "@/db/schema";
import { and, eq, gt, isNull, inArray } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";
import type { TenantHomePath } from "@/lib/products";
import { accessPayloadSchema, refreshPayloadSchema } from "./token-payload";
import { canAccessTenantArea, type TenantAccess } from "./permissions";
import { clientIp } from "@/lib/security/request-ip";

export interface AccessTokenPayload {
  sub: string;          // user id
  type: "org_user" | "platform_admin";
  orgId?: string;
  role?: string;
  email: string;
  homePath?: TenantHomePath;
  sessionId: string;
}

export interface RefreshTokenPayload {
  sub: string;
  type: "org_user" | "platform_admin";
  sessionId: string;
  tokenNonce: string;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, tokenUse: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? "15m")
    .sign(jwtSecret());
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, tokenUse: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
    .sign(refreshSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
  return accessPayloadSchema.parse(payload);
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshSecret(), { algorithms: ["HS256"] });
  return refreshPayloadSchema.parse(payload);
}

async function validateSession(token: string, type: AccessTokenPayload["type"]): Promise<AccessTokenPayload | null> {
  const payload = await verifyAccessToken(token);
  if (payload.type !== type) return null;
  const session = await db.query.authSessions.findFirst({
    where: and(eq(authSessions.id, payload.sessionId), eq(authSessions.userId, payload.sub),
      eq(authSessions.userType, type), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())),
  });
  if (!session) return null;
  if (type === "platform_admin") {
    const admin = await db.query.platformAdmins.findFirst({
      where: and(eq(platformAdmins.id, payload.sub), eq(platformAdmins.isActive, true)),
      columns: { email: true },
    });
    return admin ? { ...payload, email: admin.email } : null;
  }
  if (!payload.orgId || session.organizationId !== payload.orgId) return null;
  const user = await db.query.orgUsers.findFirst({
    where: and(eq(orgUsers.id, payload.sub), eq(orgUsers.organizationId, payload.orgId), eq(orgUsers.isActive, true)),
    columns: { role: true, email: true },
  });
  if (!user || !await isOrganizationActive(payload.orgId)) return null;
  if (!await isTenantIpAllowed(payload.orgId, await headers())) return null;
  return { ...payload, role: user.role, email: user.email };
}

export async function isOrganizationActive(orgId: string): Promise<boolean> {
  return Boolean(await db.query.organizations.findFirst({
    where: and(eq(organizations.id, orgId), inArray(organizations.status, ["active", "trial"])),
    columns: { id: true },
  }));
}

export async function getSessionFromCookies(): Promise<AccessTokenPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("access_token")?.value;
    if (!token) return null;
    return await validateSession(token, "org_user");
  } catch {
    return null;
  }
}

export async function getAdminSessionFromCookies(): Promise<AccessTokenPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_access_token")?.value;
    if (!token) return null;
    return await validateSession(token, "platform_admin");
  } catch {
    return null;
  }
}

async function getApiKeySession(requestHeaders: Headers, access: TenantAccess): Promise<
  (AccessTokenPayload & { orgId: string; role: string }) | null
> {
  const authorization = requestHeaders.get("authorization") ?? "";
  const rawKey = authorization.match(/^Bearer\s+(dk_[A-Za-z0-9]+)$/i)?.[1];
  if (!rawKey) return null;

  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
  });
  if (!key || (key.expiresAt && key.expiresAt <= new Date())) return null;
  const scopes = Array.isArray(key.scopes) ? key.scopes.filter((s): s is string => typeof s === "string") : [];
  if (!canAccessTenantArea("api_key", access, scopes)) return null;
  if (!await isOrganizationActive(key.organizationId)) return null;
  if (!await isFeatureEnabled(key.organizationId, "api_keys")) return null;
  if (!await isTenantIpAllowed(key.organizationId, requestHeaders)) return null;

  const ip = clientIp(requestHeaders);
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip === "unknown" ? null : ip })
    .where(eq(apiKeys.id, key.id));

  return {
    sub: key.id,
    sessionId: key.id,
    type: "org_user",
    orgId: key.organizationId,
    // API keys intentionally never inherit an administrator role.
    role: "api_key",
    email: `api-key:${key.name}`,
  };
}

export async function getTenantSession(access: TenantAccess = {}): Promise<
  (AccessTokenPayload & { orgId: string; role: string }) | null
> {
  const requestHeaders = await headers();
  const cookieSession = await getSessionFromCookies();
  const session = cookieSession?.type === "org_user" && cookieSession.orgId
    ? cookieSession
    : await getApiKeySession(requestHeaders, access);
  if (!session || session.type !== "org_user" || !session.orgId) return null;
  if (session.role !== "api_key" && !canAccessTenantArea(session.role ?? "", access)) return null;
  if (!await isTenantIpAllowed(session.orgId, requestHeaders)) return null;
  return session as AccessTokenPayload & { orgId: string; role: string };
}
