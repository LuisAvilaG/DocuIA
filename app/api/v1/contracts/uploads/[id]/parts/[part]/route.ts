import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { withApiSecurity } from "@/lib/security/http";
import { putUploadPart } from "@/lib/contracts/uploads";

async function handlePUT(req: NextRequest, context: { params: Promise<{ id: string; part: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id, part } = await context.params;
  try {
    await putUploadPart(id, session.orgId, session.sub, Number(part), new Uint8Array(await req.arrayBuffer()));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error de carga" }, { status: 400 });
  }
}

export const PUT = withApiSecurity(handlePUT);
