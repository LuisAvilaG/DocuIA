import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { withApiSecurity } from "@/lib/security/http";
import { cancelUpload, finishUpload } from "@/lib/contracts/uploads";

async function handlePOST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  try { return NextResponse.json(await finishUpload(id, session.orgId, session.sub)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Error al completar la carga" }, { status: 400 }); }
}

async function handleDELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isProductActive(session.orgId, "contract_intelligence")) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });
  const { id } = await context.params;
  await cancelUpload(id, session.orgId, session.sub);
  return NextResponse.json({ ok: true });
}

export const POST = withApiSecurity(handlePOST);
export const DELETE = withApiSecurity(handleDELETE);
