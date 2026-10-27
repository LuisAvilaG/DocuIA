import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { withApiSecurity } from "@/lib/security/http";
import { createUploadSession } from "@/lib/contracts/uploads";

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence") || !await isFeatureEnabled(session.orgId, "contract_ai_extraction")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const body = await req.json() as { name?: unknown; mimeType?: unknown; sizeBytes?: unknown };
  if (Number(body.sizeBytes) > 20 * 1024 * 1024 && !await isFeatureEnabled(session.orgId, "contract_large_documents")) return NextResponse.json({ error: "Documentos extensos no habilitados" }, { status: 403 });
  try {
    const result = await createUploadSession(session.orgId, session.sub, String(body.name ?? ""), String(body.mimeType ?? ""), Number(body.sizeBytes));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar la carga" }, { status: 400 });
  }
}

export const POST = withApiSecurity(handlePOST);
