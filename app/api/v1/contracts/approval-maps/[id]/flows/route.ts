import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps, contractFlows } from "@/db/schema";
import { logAudit } from "@/lib/audit/log";
import { approvalMapAdmin, readJson } from "@/lib/approval-map/admin";

// Qué flujos usan este mapa. Un flujo usa un solo mapa: asignarlo aquí lo quita del otro.
async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await approvalMapAdmin(true);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const map = await db.query.approvalMaps.findFirst({ where: and(eq(approvalMaps.id, id), eq(approvalMaps.organizationId, session.orgId)), columns: { id: true, name: true } });
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  const body = await readJson(req);
  const flowIds = Array.isArray(body.flowIds) ? [...new Set((body.flowIds as unknown[]).filter((x): x is string => typeof x === "string"))].slice(0, 200) : null;
  if (!flowIds) return NextResponse.json({ error: "Indica los flujos." }, { status: 400 });

  await db.transaction(async (tx) => {
    const released = and(eq(contractFlows.organizationId, session.orgId), eq(contractFlows.approvalMapId, id), ...(flowIds.length ? [notInArray(contractFlows.id, flowIds)] : []));
    await tx.update(contractFlows).set({ approvalMapId: null, updatedAt: new Date() }).where(released);
    if (flowIds.length) {
      await tx.update(contractFlows).set({ approvalMapId: id, updatedAt: new Date() })
        .where(and(eq(contractFlows.organizationId, session.orgId), inArray(contractFlows.id, flowIds)));
    }
  });
  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "approval_map.flows", resourceType: "approval_map", resourceId: id, metadata: { name: map.name, flowIds } });
  return NextResponse.json({ ok: true });
}

export const PUT = withApiSecurity(handlePUT);
