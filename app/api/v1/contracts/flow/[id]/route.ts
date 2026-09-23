import { withApiSecurity } from "@/lib/security/http";
import { isOrgWordTemplateKey } from "@/lib/security/storage-key";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "@/lib/contracts/flow";
import { isFeatureEnabled } from "@/lib/features";

async function guard(orgId: string) { return isProductActive(orgId, "contract_intelligence"); }

async function featureGuard(orgId: string) {
  const [productActive, enabled] = await Promise.all([
    guard(orgId), isFeatureEnabled(orgId, "contract_flow_builder"),
  ]);
  return productActive && enabled;
}

// One flow's full graph.
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await featureGuard(session.orgId)) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const { id } = await params;

  const row = await db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)),
  });
  if (!row) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const parsed = flowGraphSchema.safeParse(row.graphJson);
  return NextResponse.json({
    flow: { id: row.id, name: row.name, version: row.version, isActive: row.isActive, graph: parsed.success ? parsed.data : { nodes: [], edges: [] }, valid: parsed.success },
  });
}

interface PutBody { name?: string; graph?: unknown; version?: unknown }

async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await featureGuard(session.orgId)) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const { id } = await params;

  const existing = await db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)),
    columns: { id: true, version: true },
  });
  if (!existing) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null) as PutBody | null;
  const parsed = flowGraphSchema.safeParse(body?.graph);
  if (!parsed.success) return NextResponse.json({ error: "El flujo no es válido.", issues: parsed.error.issues.slice(0, 8) }, { status: 400 });
  if (parsed.data.nodes.some(n => n.kind === "generate" && n.data.wordTemplate && !isOrgWordTemplateKey(n.data.wordTemplate.storageKey, session.orgId))) {
    return NextResponse.json({ error: "La plantilla no pertenece a tu organización." }, { status: 400 });
  }
  if (hasCycle(parsed.data)) return NextResponse.json({ error: "El flujo tiene un ciclo; las conexiones deben ir en una sola dirección." }, { status: 400 });
  const refErr = validateFlowReferences(parsed.data);
  if (refErr) return NextResponse.json({ error: refErr }, { status: 400 });

  const stale = NextResponse.json({ error: "Otra persona guardó este flujo mientras lo editabas. Recarga la página para ver sus cambios antes de guardar." }, { status: 409 });
  if (typeof body?.version === "number" && body.version !== existing.version) return stale;

  const name = body?.name?.trim() || "Flujo de contratos";
  try {
    const saved = await db.update(contractFlows)
      .set({ name, graphJson: parsed.data, version: existing.version + 1, updatedAt: new Date() })
      .where(and(eq(contractFlows.id, id), eq(contractFlows.version, existing.version)))
      .returning({ id: contractFlows.id });
    if (!saved.length) return stale;
    return NextResponse.json({ ok: true, id, version: existing.version + 1 });
  } catch (err) {
    console.error("[contracts/flow PUT]", err);
    return NextResponse.json({ error: "Error al guardar el flujo." }, { status: 500 });
  }
}

async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await featureGuard(session.orgId)) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const { id } = await params;

  const res = await db.delete(contractFlows)
    .where(and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)))
    .returning({ id: contractFlows.id });
  if (res.length === 0) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Activation is deliberately separate from graph saving: it makes the moment a
// draft can be selected for new cases explicit and easy to audit in the UI.
async function handlePATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await featureGuard(session.orgId)) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null) as { isActive?: unknown } | null;
  if (typeof body?.isActive !== "boolean") return NextResponse.json({ error: "Estado de flujo inválido" }, { status: 400 });

  const updated = await db.update(contractFlows)
    .set({ isActive: body.isActive, updatedAt: new Date() })
    .where(and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)))
    .returning({ id: contractFlows.id, isActive: contractFlows.isActive });
  if (updated.length === 0) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, flow: updated[0] });
}

export const GET = withApiSecurity(handleGET);
export const PUT = withApiSecurity(handlePUT);
export const DELETE = withApiSecurity(handleDELETE);
export const PATCH = withApiSecurity(handlePATCH);
