import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "@/lib/contracts/flow";

async function guard(orgId: string) { return isProductActive(orgId, "contract_intelligence"); }

// One flow's full graph.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await params;

  const row = await db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)),
  });
  if (!row) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const parsed = flowGraphSchema.safeParse(row.graphJson);
  return NextResponse.json({
    flow: { id: row.id, name: row.name, version: row.version, graph: parsed.success ? parsed.data : { nodes: [], edges: [] }, valid: parsed.success },
  });
}

interface PutBody { name?: string; graph?: unknown }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await params;

  const existing = await db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)),
    columns: { id: true, version: true },
  });
  if (!existing) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null) as PutBody | null;
  const parsed = flowGraphSchema.safeParse(body?.graph);
  if (!parsed.success) return NextResponse.json({ error: "El flujo no es válido.", issues: parsed.error.issues.slice(0, 8) }, { status: 400 });
  if (hasCycle(parsed.data)) return NextResponse.json({ error: "El flujo tiene un ciclo; las conexiones deben ir en una sola dirección." }, { status: 400 });
  const refErr = validateFlowReferences(parsed.data);
  if (refErr) return NextResponse.json({ error: refErr }, { status: 400 });

  const name = body?.name?.trim() || "Flujo de contratos";
  try {
    await db.update(contractFlows)
      .set({ name, graphJson: parsed.data, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(contractFlows.id, id));
    return NextResponse.json({ ok: true, id, version: existing.version + 1 });
  } catch (err) {
    console.error("[contracts/flow PUT]", err);
    return NextResponse.json({ error: "Error al guardar el flujo." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await params;

  const res = await db.delete(contractFlows)
    .where(and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)))
    .returning({ id: contractFlows.id });
  if (res.length === 0) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
