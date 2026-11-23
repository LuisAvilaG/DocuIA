import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { logAudit } from "@/lib/audit/log";
import { addCorrectedDocuments } from "@/lib/contracts/uploads";
import { enqueueContractCase } from "@/lib/queue";

/** Reingreso: agrega los documentos corregidos al caso que los esperaba y lo vuelve a analizar. */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { items?: unknown };
  const items = Array.isArray(body.items)
    ? body.items.flatMap((it) => {
      const x = it as { uploadId?: unknown; replaces?: unknown };
      return typeof x.uploadId === "string" ? [{ uploadId: x.uploadId, replaces: typeof x.replaces === "string" && x.replaces ? x.replaces : null }] : [];
    })
    : [];
  try {
    await addCorrectedDocuments({ organizationId: session.orgId, userId: session.sub, caseId: id, items });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudieron agregar los documentos" }, { status: 400 });
  }
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.documents_resubmitted", resourceType: "contract_case", resourceId: id, metadata: { files: items.length, replaced: items.filter((i) => i.replaces).length } });
  await enqueueContractCase(id);
  return NextResponse.json({ ok: true, status: "uploaded" });
}

export const POST = withApiSecurity(handlePOST);
