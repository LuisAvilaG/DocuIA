import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { randomBytes, createHash } from "crypto";
import { v4 as uuid } from "uuid";

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const enabled = await isFeatureEnabled(session.orgId, "api_keys");
  if (!enabled) return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });

  const keys = await db
    .select({
      id:          apiKeys.id,
      name:        apiKeys.name,
      keyPrefix:   apiKeys.keyPrefix,
      revokedAt:   apiKeys.revokedAt,
      lastUsedAt:  apiKeys.lastUsedAt,
      expiresAt:   apiKeys.expiresAt,
      createdAt:   apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, session.orgId))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json(keys.map(k => ({ ...k, isActive: k.revokedAt === null })));
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled(session.orgId, "api_keys");
  if (!enabled) return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const rawKey    = `dk_${randomBytes(32).toString("hex")}`;
  const keyHash   = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 12);

  const [key] = await db.insert(apiKeys).values({
    id:             uuid(),
    organizationId: session.orgId,
    name,
    keyHash,
    keyPrefix,
    scopes:         [],
    createdBy:      session.sub,
  }).returning({
    id:        apiKeys.id,
    name:      apiKeys.name,
    keyPrefix: apiKeys.keyPrefix,
    createdAt: apiKeys.createdAt,
  });

  return NextResponse.json({ ...key, isActive: true, rawKey });
}
