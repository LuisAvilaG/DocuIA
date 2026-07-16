import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { jwtSecret, refreshSecret } from "@/lib/env";

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

export async function getTenantSession(): Promise<
  (AccessTokenPayload & { orgId: string; role: string }) | null
> {
  const session = await getSessionFromCookies();
  if (!session || session.type !== "org_user" || !session.orgId) return null;
  return session as AccessTokenPayload & { orgId: string; role: string };
}
