import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { setAdminGrant, getAllFeatures } from "@/lib/features";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/db/schema";
import { ensureBucket } from "@/lib/storage/minio";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdminSession();
  if (error) return error;
  const { id: orgId } = await params;
  const features = await getAllFeatures(orgId);
  return NextResponse.json({ features });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> }
) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  const { id: orgId, featureId } = await params;
  const { adminGranted, config, notes } = await req.json();

  await setAdminGrant(orgId, featureId, adminGranted, config, session.sub, notes);

  if (featureId === "document_storage" && adminGranted) {
    try { await ensureBucket(); } catch (e) { console.error("[features PATCH] ensureBucket failed:", e); }
  }

  await db.insert(adminAuditLog).values({
    adminId: session.sub,
    adminEmail: session.email,
    action: "toggle_feature",
    targetOrgId: orgId,
    targetFeature: featureId,
    afterJson: { adminGranted, config, notes },
    ipAddress: req.headers.get("x-forwarded-for") ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  });

  return NextResponse.json({ ok: true });
}
