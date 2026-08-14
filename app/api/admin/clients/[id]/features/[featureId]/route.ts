import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { setAdminGrant, getAllFeatures } from "@/lib/features";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/db/schema";
import { ensureBucket } from "@/lib/storage/minio";
import { subsidiaries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateCustomFormsConfig } from "@/lib/netsuite/custom-forms";
import { validateExpenseManagementConfig } from "@/lib/expense/config";

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

  if (typeof adminGranted !== "boolean" || !config || typeof config !== "object") {
    return NextResponse.json({ error: "Configuración inválida" }, { status: 400 });
  }
  if (featureId === "custom_netsuite_forms") {
    const rows = await db.query.subsidiaries.findMany({
      where: eq(subsidiaries.organizationId, orgId), columns: { id: true },
    });
    const validationError = validateCustomFormsConfig(config, new Set(rows.map(row => row.id)));
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (featureId === "expense_management") {
    const validationError = validateExpenseManagementConfig(config);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  }

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
