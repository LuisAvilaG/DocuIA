import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalEditorContext, approvalMapAdmin, mapContextFrom } from "@/lib/approval-map/admin";
import { mapGraphSchema, validateMap } from "@/lib/approval-map/engine";

// Publica el borrador: lo reciben los casos que terminen de analizarse desde ahora.
async function handlePOST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const map = await db.query.approvalMaps.findFirst({ where: and(eq(approvalMaps.id, id), eq(approvalMaps.organizationId, session.orgId)) });
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  const draft = mapGraphSchema.safeParse(map.draftJson);
  if (!draft.success) return NextResponse.json({ error: "El borrador no se pudo leer." }, { status: 400 });
  const issues = validateMap(draft.data, mapContextFrom(await approvalEditorContext(session.orgId)));
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length) return NextResponse.json({ error: "Corrige el mapa antes de publicarlo.", issues }, { status: 400 });

  const version = map.version + 1;
  await db.update(approvalMaps).set({ publishedJson: draft.data, version, publishedAt: new Date(), publishedBy: session.sub, updatedAt: new Date() })
    .where(eq(approvalMaps.id, id));
  await logAudit({
    orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_map.published",
    resourceType: "approval_map", resourceId: id,
    metadata: { name: map.name, version, nodes: draft.data.nodes.length, warnings: issues.map((issue) => issue.message) },
  });
  return NextResponse.json({ ok: true, version, issues });
}

export const POST = withApiSecurity(handlePOST);
