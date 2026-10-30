import { withApiSecurity } from "@/lib/security/http";
import { logAdminAction } from "@/lib/audit/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { nsConnections, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { encryptField } from "@/lib/crypto/encrypt";
import { testNsCredentials } from "@/lib/netsuite/client";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const [connections, org] = await Promise.all([
      db.query.nsConnections.findMany({
        where: eq(nsConnections.organizationId, organizationId),
        columns: {
          id: true, environment: true, accountId: true,
          catalogScriptId: true, catalogDeployId: true,
          processScriptId: true, processDeployId: true,
          connectionStatus: true, connectionTestedAt: true, connectionError: true,
          scriptsInstalled: true, installMethod: true, isActive: true, updatedAt: true,
          // secrets omitted intentionally
        },
      }),
      db.query.organizations.findFirst({
        where: eq(organizations.id, organizationId),
        columns: { activeNsEnvironment: true },
      }),
    ]);

    return NextResponse.json({
      connections,
      activeEnvironment: org?.activeNsEnvironment ?? "sandbox",
    });
  } catch (err) {
    console.error("[clients/connection GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();
    const {
      environment,
      accountId,
      consumerKey,
      consumerSecret,
      tokenId,
      tokenSecret,
      catalogScriptId,
      catalogDeployId,
      processScriptId,
      processDeployId,
      connectionStatus,
      scriptsInstalled,
      installMethod,
    } = body;

    if (!environment || !accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      return NextResponse.json({ error: "environment and TBA credentials are required" }, { status: 400 });
    }
    if (environment !== "sandbox" && environment !== "production") {
      return NextResponse.json({ error: "environment must be sandbox or production" }, { status: 400 });
    }

    // "Guardar y probar": the credentials are checked against the ERP right
    // away, so the environment can be activated without a second step.
    let tested: boolean | null = null;
    let testError: string | null = null;
    let effectiveStatus: "pending" | "connected" | "error" | undefined = connectionStatus;
    if (body.test === true) {
      const probe = await testNsCredentials({ accountId, consumerKey, consumerSecret, tokenId, tokenSecret });
      tested = probe.ok;
      testError = probe.ok ? null : (probe.error ?? "Error desconocido");
      effectiveStatus = probe.ok ? "connected" : "error";
    }

    const encConsumerKey    = encryptField(consumerKey);
    const encConsumerSecret = encryptField(consumerSecret);
    const encTokenId        = encryptField(tokenId);
    const encTokenSecret    = encryptField(tokenSecret);

    const existing = await db.query.nsConnections.findFirst({
      where: and(
        eq(nsConnections.organizationId, organizationId),
        eq(nsConnections.environment, environment),
      ),
    });

    const now = new Date();

    if (existing) {
      await db.update(nsConnections)
        .set({
          accountId,
          consumerKey:    encConsumerKey,
          consumerSecret: encConsumerSecret,
          tokenId:        encTokenId,
          tokenSecret:    encTokenSecret,
          catalogScriptId: catalogScriptId ?? existing.catalogScriptId,
          catalogDeployId: catalogDeployId ?? existing.catalogDeployId,
          processScriptId: processScriptId ?? existing.processScriptId,
          processDeployId: processDeployId ?? existing.processDeployId,
          connectionStatus: effectiveStatus ?? "pending",
          connectionTestedAt: effectiveStatus === "connected" || tested !== null ? now : null,
          connectionError: tested === false ? testError : effectiveStatus === "connected" ? null : existing.connectionError,
          scriptsInstalled: scriptsInstalled ?? existing.scriptsInstalled,
          scriptsInstalledAt: scriptsInstalled && !existing.scriptsInstalled ? now : existing.scriptsInstalledAt,
          installMethod: installMethod ?? existing.installMethod,
          updatedAt: now,
        })
        .where(eq(nsConnections.id, existing.id));

      await logAdminAction(req, session!, { action: "netsuite_connection.updated", targetOrgId: organizationId, after: { environment, accountId, tested } });
      return NextResponse.json({ ok: tested !== false, connectionId: existing.id, tested, error: testError, status: effectiveStatus ?? "pending" }, { status: tested === false ? 422 : 200 });
    }

    const connectionId = randomUUID();
    await db.insert(nsConnections).values({
      id: connectionId,
      organizationId,
      environment,
      accountId,
      consumerKey:    encConsumerKey,
      consumerSecret: encConsumerSecret,
      tokenId:        encTokenId,
      tokenSecret:    encTokenSecret,
      catalogScriptId: catalogScriptId ?? null,
      catalogDeployId: catalogDeployId ?? null,
      processScriptId: processScriptId ?? null,
      processDeployId: processDeployId ?? null,
      connectionStatus: effectiveStatus ?? "pending",
      connectionTestedAt: effectiveStatus === "connected" || tested !== null ? now : null,
      connectionError: tested === false ? testError : null,
      scriptsInstalled: scriptsInstalled ?? false,
      scriptsInstalledAt: scriptsInstalled ? now : null,
      installMethod: installMethod ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await logAdminAction(req, session!, { action: "netsuite_connection.created", targetOrgId: organizationId, after: { environment, accountId, tested } });
    return NextResponse.json({ ok: tested !== false, connectionId, tested, error: testError, status: effectiveStatus ?? "pending" }, { status: tested === false ? 422 : 201 });
  } catch (err) {
    console.error("[clients/connection POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** PATCH — update only script IDs for an existing connection (no credentials needed) */
async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();
    const { environment, catalogScriptId, catalogDeployId, processScriptId, processDeployId } = body;

    if (!environment) {
      return NextResponse.json({ error: "environment is required" }, { status: 400 });
    }

    const existing = await db.query.nsConnections.findFirst({
      where: and(
        eq(nsConnections.organizationId, organizationId),
        eq(nsConnections.environment, environment),
      ),
    });

    if (!existing) {
      return NextResponse.json({ error: "Connection not found — save credentials first" }, { status: 404 });
    }

    await db.update(nsConnections)
      .set({
        catalogScriptId: catalogScriptId ?? existing.catalogScriptId,
        catalogDeployId: catalogDeployId ?? existing.catalogDeployId,
        processScriptId: processScriptId ?? existing.processScriptId,
        processDeployId: processDeployId ?? existing.processDeployId,
        updatedAt: new Date(),
      })
      .where(eq(nsConnections.id, existing.id));

    await logAdminAction(req, session!, { action: "netsuite_scripts.updated", targetOrgId: organizationId, after: { environment, catalogScriptId, processScriptId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clients/connection PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
export const PATCH = withApiSecurity(handlePATCH);
