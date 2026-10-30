import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { nsConnections } from "@/db/schema";
import { nsCredentials } from "@/lib/netsuite/connection";
import { probeCatalogScript, testNsCredentials } from "@/lib/netsuite/client";

type Params = { params: Promise<{ id: string }> };

/**
 * Tests the credentials already stored for one environment and records the
 * result on the connection, so an environment saved from the client panel
 * can become "connected" and then be activated.
 */
async function handlePOST(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;
  const { id: organizationId } = await params;
  const body = await req.json().catch(() => ({})) as { environment?: unknown };
  const environment = body.environment === "production" ? "production" : body.environment === "sandbox" ? "sandbox" : null;
  if (!environment) return NextResponse.json({ error: "environment debe ser sandbox o production" }, { status: 400 });

  const conn = await db.query.nsConnections.findFirst({
    where: and(eq(nsConnections.organizationId, organizationId), eq(nsConnections.environment, environment)),
  });
  if (!conn) return NextResponse.json({ error: "No hay credenciales guardadas para ese entorno" }, { status: 404 });

  const creds = nsCredentials(conn);
  const now = new Date();
  const result = await testNsCredentials(creds);
  let scriptsOk: boolean | null = null;
  let scriptVersion: string | null = null;
  if (result.ok && conn.catalogScriptId && conn.catalogDeployId) {
    const probe = await probeCatalogScript(creds, conn.catalogScriptId, conn.catalogDeployId);
    scriptsOk = probe.ok;
    scriptVersion = probe.ok ? (probe.data?.version ?? null) : null;
  }

  await db.update(nsConnections).set({
    connectionStatus:   result.ok ? "connected" : "error",
    connectionTestedAt: now,
    connectionError:    result.ok ? null : (result.error ?? "Error desconocido"),
    ...(scriptsOk !== null ? { scriptsInstalled: scriptsOk, ...(scriptsOk && !conn.scriptsInstalledAt ? { scriptsInstalledAt: now } : {}) } : {}),
    updatedAt: now,
  }).where(eq(nsConnections.id, conn.id));

  await logAdminAction(req, session!, {
    action: "netsuite_connection.tested", targetOrgId: organizationId,
    after: { environment, ok: result.ok, error: result.ok ? null : result.error, scriptsOk, scriptVersion },
  });

  return NextResponse.json({ ok: result.ok, error: result.ok ? null : result.error, scriptsOk, scriptVersion, testedAt: now.toISOString() }, { status: result.ok ? 200 : 422 });
}

export const POST = withApiSecurity(handlePOST);
