import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { setAdminGrant, getAllFeatures } from "@/lib/features";
import { db } from "@/lib/db";
import { orgFeatures, organizations } from "@/db/schema";
import { ensureBucket } from "@/lib/storage/minio";
import { subsidiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateCustomFormsConfig } from "@/lib/netsuite/custom-forms";
import { validateExpenseManagementConfig } from "@/lib/expense/config";
import { normalizeQaConfig } from "@/lib/features/qa-mode";
import { logAdminAction } from "@/lib/audit/admin";

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdminSession();
  if (error) return error;
  const { id: orgId } = await params;
  const features = await getAllFeatures(orgId);
  return NextResponse.json({ features });
}

// Written by the client (its own on/off) and by the scheduled jobs.
const RUNTIME_KEYS = ["tenant_off", "last_sent_period", "last_check_at"];

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> }
) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  const { id: orgId, featureId } = await params;
  const body = await req.json();
  const { adminGranted, notes } = body;

  const before = await db.query.orgFeatures.findFirst({
    where: and(eq(orgFeatures.organizationId, orgId), eq(orgFeatures.featureId, featureId)),
    columns: { adminGranted: true, configJson: true, notes: true },
  });
  const stored = (before?.configJson && typeof before.configJson === "object" ? before.configJson : {}) as Record<string, unknown>;
  // Without a config in the body (a switch or a note) the stored one stays.
  // With one, it is laid over the stored config, and the keys the client and
  // the scheduled jobs own are never taken from the page, which may be stale.
  if (typeof adminGranted !== "boolean" || (body.config !== undefined && (!body.config || typeof body.config !== "object"))) {
    return NextResponse.json({ error: "Configuración inválida" }, { status: 400 });
  }
  let config: Record<string, unknown> = { ...stored, ...(body.config ?? {}) };
  for (const key of RUNTIME_KEYS) {
    if (key in stored) config[key] = stored[key]; else delete config[key];
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
  if (featureId === "qa_mode" && adminGranted) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId), columns: { activeNsEnvironment: true },
    });
    const result = normalizeQaConfig(config, org?.activeNsEnvironment);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    config = { ...result.config };
  }

  await setAdminGrant(orgId, featureId, adminGranted, config, session.sub, notes);

  if (featureId === "document_storage" && adminGranted) {
    try { await ensureBucket(); } catch (e) { console.error("[features PATCH] ensureBucket failed:", e); }
  }

  await logAdminAction(req, session, {
    action: "toggle_feature",
    targetOrgId: orgId,
    targetFeature: featureId,
    before: before ? { adminGranted: before.adminGranted, config: before.configJson, notes: before.notes } : null,
    after: { adminGranted, config, notes },
  });

  return NextResponse.json({ ok: true, config });
}

export const GET = withApiSecurity(handleGET);
export const PATCH = withApiSecurity(handlePATCH);
