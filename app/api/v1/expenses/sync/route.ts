import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { nsConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptField } from "@/lib/crypto/encrypt";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import {
  syncExpenseCategories,
  syncDepartments,
  syncClasses,
  syncEmployees,
} from "@/lib/expense/sync-catalogs";

async function resolveNsCreds(orgId: string): Promise<NSCredentials | null> {
  const conn = await db.query.nsConnections.findFirst({
    where: and(eq(nsConnections.organizationId, orgId), eq(nsConnections.isActive, true)),
  });
  if (!conn) return null;
  return {
    accountId:      conn.accountId,
    consumerKey:    decryptField(conn.consumerKey),
    consumerSecret: decryptField(conn.consumerSecret),
    tokenId:        decryptField(conn.tokenId),
    tokenSecret:    decryptField(conn.tokenSecret),
  };
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const body = await req.json() as {
    action: "sync_categories" | "sync_departments" | "sync_classes" | "sync_employees" | "sync_all";
    subsidiaryId?: string;
  };

  const creds = await resolveNsCreds(session.orgId);
  if (!creds) {
    return NextResponse.json(
      { error: "No hay conexión NetSuite activa. Contacta al administrador de DocuIA." },
      { status: 422 },
    );
  }

  const subsidiaryId = body.subsidiaryId ?? null;

  try {
    const results: Record<string, unknown> = {};

    if (body.action === "sync_categories" || body.action === "sync_all") {
      results.categories = await syncExpenseCategories(session.orgId, subsidiaryId, creds);
    }
    if (body.action === "sync_departments" || body.action === "sync_all") {
      results.departments = await syncDepartments(session.orgId, subsidiaryId, creds);
    }
    if (body.action === "sync_classes" || body.action === "sync_all") {
      results.classes = await syncClasses(session.orgId, subsidiaryId, creds);
    }
    if (body.action === "sync_employees" || body.action === "sync_all") {
      results.employees = await syncEmployees(session.orgId, creds);
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[v1/expenses/sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error durante la sincronización" },
      { status: 502 },
    );
  }
}
