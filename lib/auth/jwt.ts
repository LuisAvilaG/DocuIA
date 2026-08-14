import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { jwtSecret, refreshSecret } from "@/lib/env";
import { isTenantIpAllowed } from "@/lib/security/ip-allowlist";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";

export interface AccessTokenPayload {
  sub: string;          // user id
  type: "org_user" | "platform_admin";
  orgId?: string;
  role?: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
  type: "org_user" | "platform_admin";
  sessionId: string;
  tokenNonce: string;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? "15m")
    .sign(jwtSecret());
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
    .sign(refreshSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
  return payload as unknown as AccessTokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshSecret(), { algorithms: ["HS256"] });
  return payload as unknown as RefreshTokenPayload;
}

export async function getSessionFromCookies(): Promise<AccessTokenPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("access_token")?.value;
    if (!token) return null;
    return await verifyAccessToken(token);
  } catch {
    return null;
  }
}

export async function getAdminSessionFromCookies(): Promise<AccessTokenPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_access_token")?.value;
    if (!token) return null;
    return await verifyAccessToken(token);
  } catch {
    return null;
  }
}

async function getApiKeySession(requestHeaders: Headers): Promise<
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
  if (!await isFeatureEnabled(key.organizationId, "api_keys")) return null;
  if (!await isTenantIpAllowed(key.organizationId, requestHeaders)) return null;

  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: forwardedFor?.slice(0, 64) ?? null })
    .where(eq(apiKeys.id, key.id));

  return {
    sub: `api_key:${key.id}`,
    type: "org_user",
    orgId: key.organizationId,
    // API keys intentionally never inherit an administrator role.
    role: "api_key",
    email: `api-key:${key.name}`,
  };
}

export async function getTenantSession(): Promise<
  (AccessTokenPayload & { orgId: string; role: string }) | null
> {
  const requestHeaders = await headers();
  const cookieSession = await getSessionFromCookies();
  const session = cookieSession?.type === "org_user" && cookieSession.orgId
    ? cookieSession
    : await getApiKeySession(requestHeaders);
  if (!session || session.type !== "org_user" || !session.orgId) return null;
  if (!await isTenantIpAllowed(session.orgId, requestHeaders)) return null;
  return session as AccessTokenPayload & { orgId: string; role: string };
}
