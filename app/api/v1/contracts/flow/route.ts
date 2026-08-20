import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "@/lib/contracts/flow";
import { getContractFlowLimit, getContractFlowCount } from "@/lib/contracts/plan";
import { isFeatureEnabled } from "@/lib/features";

async function guard(orgId: string) { return isProductActive(orgId, "contract_intelligence"); }

async function featureGuard(orgId: string) {
  const [productActive, enabled] = await Promise.all([
    guard(orgId), isFeatureEnabled(orgId, "contract_flow_builder"),
  ]);
  return productActive && enabled;
}

const EMPTY_GRAPH = { nodes: [], edges: [] };

// List the org's flows + the quota, for the picker.
export async function GET(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "1";
  if (activeOnly) {
    if (!(await guard(session.orgId)) || !(await isFeatureEnabled(session.orgId, "contract_ai_extraction"))) {
      return NextResponse.json({ error: "El análisis de contratos no está habilitado" }, { status: 403 });
    }
  } else if (!await featureGuard(session.orgId)) {
    return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  }

  const [rows, maxFlows] = await Promise.all([
    db.query.contractFlows.findMany({
      where: activeOnly
        ? and(eq(contractFlows.organizationId, session.orgId), eq(contractFlows.isActive, true))
        : eq(contractFlows.organizationId, session.orgId),
      columns: { id: true, name: true, version: true, isActive: true, updatedAt: true, graphJson: true },
      orderBy: [desc(contractFlows.updatedAt)],
    }),
    getContractFlowLimit(session.orgId),
  ]);
  const flows = rows.map(({ graphJson, ...flow }) => {
    const graph = flowGraphSchema.safeParse(graphJson);
    const nodes = graph.success ? graph.data.nodes : [];
    return {
      ...flow,
      documentCount: nodes.filter((node) => node.kind === "intake").length,
      validationCount: nodes.filter((node) => node.kind === "validate").length,
    };
  });
  return NextResponse.json({ flows, maxFlows, count: flows.length });
}

interface PostBody { name?: string; graph?: unknown }

// Create a new flow (respecting the per-client quota).
export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await featureGuard(session.orgId)) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });

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
  // A flow must be reviewed before it can affect a real case.
  await db.insert(contractFlows).values({ id, organizationId: session.orgId, name, graphJson: parsed.data, isActive: false });
  return NextResponse.json({ ok: true, id, name, version: 1 }, { status: 201 });
}
