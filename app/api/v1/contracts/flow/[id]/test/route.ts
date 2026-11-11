import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { flowVersionsConfig, graphProblem } from "@/lib/contracts/flow-versions";
import { testDraftOnCases } from "@/lib/contracts/flow-test";

/** Prueba el borrador guardado con los últimos casos del flujo. No llama a la IA ni cambia los casos. */
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_flow_builder")) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const config = await flowVersionsConfig(session.orgId);
  if (!config.enabled) return NextResponse.json({ error: "Las versiones de flujo no están activas para tu empresa." }, { status: 403 });

  const { id } = await params;
  const flow = await db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)) });
  if (!flow) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });
  const draft = flowGraphSchema.safeParse(flow.draftJson ?? flow.graphJson);
  if (!draft.success) return NextResponse.json({ error: "El borrador no es válido." }, { status: 400 });
  const problem = graphProblem(draft.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const cases = await testDraftOnCases(session.orgId, id, draft.data, config.testCases);
  return NextResponse.json({ cases });
}

export const POST = withApiSecurity(handlePOST);
