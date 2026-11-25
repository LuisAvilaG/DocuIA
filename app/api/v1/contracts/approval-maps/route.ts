import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps, contractFlows } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalMapAdmin, readJson } from "@/lib/approval-map/admin";
import { emptyMap } from "@/lib/approval-map/engine";

// Los mapas de la organización (la pantalla Mapas lee lo mismo en el servidor).
async function handleGET() {
  const auth = await approvalMapAdmin(false);
  if ("response" in auth) return auth.response;
  const maps = await db.query.approvalMaps.findMany({
    where: eq(approvalMaps.organizationId, auth.session.orgId),
    columns: { id: true, name: true, version: true, publishedAt: true },
    orderBy: (m, { asc }) => [asc(m.name)],
  });
  return NextResponse.json({ maps });
}

// Un mapa nuevo desde un punto de partida, opcionalmente ya asignado a flujos.
async function handlePOST(req: NextRequest) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 150) : "";
  if (!name) return NextResponse.json({ error: "Escribe el nombre del mapa." }, { status: 400 });
  const start = ["single", "flow", "field", "blank"].includes(String(body.start)) ? body.start as "single" | "flow" | "field" | "blank" : "blank";
  const flowIds = Array.isArray(body.flowIds) ? (body.flowIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 100) : [];

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(approvalMaps).values({ id, organizationId: session.orgId, name, draftJson: emptyMap(start) });
    if (flowIds.length) {
      await tx.update(contractFlows).set({ approvalMapId: id, updatedAt: new Date() })
        .where(and(eq(contractFlows.organizationId, session.orgId), inArray(contractFlows.id, flowIds)));
    }
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_map.created", resourceType: "approval_map", resourceId: id, metadata: { name, start, flowIds } });
  return NextResponse.json({ id }, { status: 201 });
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
