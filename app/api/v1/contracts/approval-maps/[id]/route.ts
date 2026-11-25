import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps, contractFlows } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalEditorContext, approvalMapAdmin, mapContextFrom, readJson } from "@/lib/approval-map/admin";
import { mapGraphSchema, validateMap } from "@/lib/approval-map/engine";

type Params = { params: Promise<{ id: string }> };

async function findMap(orgId: string, id: string) {
  return db.query.approvalMaps.findFirst({ where: and(eq(approvalMaps.id, id), eq(approvalMaps.organizationId, orgId)) });
}

// El mapa para el editor: borrador, versión publicada y todo lo que se puede elegir.
async function handleGET(_req: NextRequest, { params }: Params) {
  const auth = await approvalMapAdmin(false);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const map = await findMap(auth.session.orgId, id);
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  const context = await approvalEditorContext(auth.session.orgId);
  const draft = mapGraphSchema.safeParse(map.draftJson);
  return NextResponse.json({
    map: { id: map.id, name: map.name, version: map.version, publishedAt: map.publishedAt, draft: draft.success ? draft.data : null, published: map.publishedJson ?? null },
    context,
    issues: draft.success ? validateMap(draft.data, mapContextFrom(context)) : [{ level: "error", message: "El borrador guardado no se pudo leer." }],
  });
}

// Guarda el borrador (y el nombre). Los casos siguen con la versión publicada.
async function handlePUT(req: NextRequest, { params }: Params) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const map = await findMap(session.orgId, id);
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 150) : map.name;
  if (!name) return NextResponse.json({ error: "Escribe el nombre del mapa." }, { status: 400 });
  let draftJson = map.draftJson;
  if (body.draft !== undefined) {
    const parsed = mapGraphSchema.safeParse(body.draft);
    if (!parsed.success) return NextResponse.json({ error: "El mapa no tiene una forma válida." }, { status: 400 });
    draftJson = parsed.data;
  }
  await db.update(approvalMaps).set({ name, draftJson, updatedAt: new Date() }).where(eq(approvalMaps.id, id));
  const context = await approvalEditorContext(session.orgId);
  const issues = validateMap(mapGraphSchema.parse(draftJson), mapContextFrom(context));
  return NextResponse.json({ ok: true, issues });
}

// Borra el mapa: sus flujos vuelven a aprobarse como antes (la etapa Aprobación).
async function handleDELETE(_req: NextRequest, { params }: Params) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const map = await findMap(session.orgId, id);
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  await db.transaction(async (tx) => {
    await tx.update(contractFlows).set({ approvalMapId: null, updatedAt: new Date() })
      .where(and(eq(contractFlows.organizationId, session.orgId), eq(contractFlows.approvalMapId, id)));
    await tx.delete(approvalMaps).where(eq(approvalMaps.id, id));
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_map.deleted", resourceType: "approval_map", resourceId: id, metadata: { name: map.name } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiSecurity(handleGET);
export const PUT = withApiSecurity(handlePUT);
export const DELETE = withApiSecurity(handleDELETE);
