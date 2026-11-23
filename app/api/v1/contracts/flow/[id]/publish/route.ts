import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit/log";
import { enqueueContractCase } from "@/lib/queue";
import { flowVersionsConfig, publishFlow } from "@/lib/contracts/flow-versions";

/** Publica el borrador como nueva versión, con nota y qué pasa con los casos abiertos. */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_flow_builder")) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  const config = await flowVersionsConfig(session.orgId);
  if (!config.enabled) return NextResponse.json({ error: "Las versiones de flujo no están activas para tu empresa." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { note?: unknown; reanalyze?: unknown; version?: unknown };
  const result = await publishFlow({
    orgId: session.orgId, userId: session.sub, flowId: id,
    expectedVersion: typeof body.version === "number" ? body.version : null,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "",
    reanalyze: body.reanalyze === true,
    maxVersions: config.maxVersions,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  for (const caseId of result.reanalyzeIds) await enqueueContractCase(caseId);
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.flow_published", resourceType: "contract_flow", resourceId: id, metadata: { version: result.version, changes: result.changes, reanalyzed: result.reanalyzeIds.length } });
  return NextResponse.json({ ok: true, version: result.version, changes: result.changes, reanalyzed: result.reanalyzeIds.length });
}

export const POST = withApiSecurity(handlePOST);
