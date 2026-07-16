import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "@/lib/contracts/flow";
import { getContractFlowLimit, getContractFlowCount } from "@/lib/contracts/plan";

async function guard(orgId: string) { return isProductActive(orgId, "contract_intelligence"); }

const EMPTY_GRAPH = { nodes: [], edges: [] };

// List the org's flows + the quota, for the picker.
export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });

  const [rows, maxFlows] = await Promise.all([
    db.query.contractFlows.findMany({
      where: eq(contractFlows.organizationId, session.orgId),
      columns: { id: true, name: true, version: true, updatedAt: true },
      orderBy: [desc(contractFlows.updatedAt)],
    }),
    getContractFlowLimit(session.orgId),
  ]);
  return NextResponse.json({ flows: rows, maxFlows, count: rows.length });
}

interface PostBody { name?: string; graph?: unknown }

// Create a new flow (respecting the per-client quota).
export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });

  const [limit, current] = await Promise.all([getContractFlowLimit(session.orgId), getContractFlowCount(session.orgId)]);
  if (current >= limit) {
    return NextResponse.json({ error: `Alcanzaste el máximo de ${limit} flujo(s) para este cliente.` }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as PostBody | null;
  const name = body?.name?.trim() || "Nuevo flujo";
  const parsed = flowGraphSchema.safeParse(body?.graph ?? EMPTY_GRAPH);
  if (!parsed.success) return NextResponse.json({ error: "Flujo inválido", issues: parsed.error.issues.slice(0, 8) }, { status: 400 });
  if (hasCycle(parsed.data)) return NextResponse.json({ error: "El flujo tiene un ciclo." }, { status: 400 });
  const refErr = validateFlowReferences(parsed.data);
  if (refErr) return NextResponse.json({ error: refErr }, { status: 400 });

  const id = randomUUID();
  await db.insert(contractFlows).values({ id, organizationId: session.orgId, name, graphJson: parsed.data });
  return NextResponse.json({ ok: true, id, name, version: 1 }, { status: 201 });
}
