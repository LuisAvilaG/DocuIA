import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import {
  nsConnections, expenseCategories, catalogDepartments,
  catalogClasses, orgUsers,
} from "@/db/schema";
import { and, eq, count } from "drizzle-orm";
import { decryptField } from "@/lib/crypto/encrypt";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import {
  syncExpenseCategories,
  syncDepartments,
  syncClasses,
  syncEmployees,
} from "@/lib/expense/sync-catalogs";

type Params = { params: Promise<{ id: string }> };

async function resolveNsCreds(organizationId: string): Promise<NSCredentials | null> {
  const conn = await db.query.nsConnections.findFirst({
    where: and(
      eq(nsConnections.organizationId, organizationId),
      eq(nsConnections.isActive, true),
    ),
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

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;

  const [catCount, deptCount, classCount, employeeCount] = await Promise.all([
    db.select({ n: count() }).from(expenseCategories)
      .where(and(eq(expenseCategories.organizationId, organizationId), eq(expenseCategories.isActive, true))),
    db.select({ n: count() }).from(catalogDepartments)
      .where(and(eq(catalogDepartments.organizationId, organizationId), eq(catalogDepartments.isInactive, false))),
    db.select({ n: count() }).from(catalogClasses)
      .where(and(eq(catalogClasses.organizationId, organizationId), eq(catalogClasses.isInactive, false))),
    db.select({ n: count() }).from(orgUsers)
      .where(and(eq(orgUsers.organizationId, organizationId), eq(orgUsers.role, "expense_submitter"))),
  ]);

  const categories = await db.query.expenseCategories.findMany({
    where: and(
      eq(expenseCategories.organizationId, organizationId),
      eq(expenseCategories.isActive, true),
    ),
    columns: {
      id: true, name: true, netsuiteCategoryId: true,
      netsuiteAccountName: true, dailyCap: true, monthlyCap: true, syncedAt: true,
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });

  return NextResponse.json({
    counts: {
      categories:  catCount[0].n,
      departments: deptCount[0].n,
      classes:     classCount[0].n,
      employees:   employeeCount[0].n,
    },
    categories,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;

  const body = await req.json() as {
    action: "sync_categories" | "sync_departments" | "sync_classes" | "sync_employees" | "sync_all";
    subsidiaryId?: string;
  };

  const creds = await resolveNsCreds(organizationId);
  if (!creds) {
    return NextResponse.json({ error: "No hay conexión NetSuite activa para este cliente" }, { status: 422 });
  }

  const subsidiaryId = body.subsidiaryId ?? null;

  try {
    const results: Record<string, unknown> = {};

    if (body.action === "sync_categories" || body.action === "sync_all") {
      results.categories = await syncExpenseCategories(organizationId, subsidiaryId, creds);
    }
    if (body.action === "sync_departments" || body.action === "sync_all") {
      results.departments = await syncDepartments(organizationId, subsidiaryId, creds);
    }
    if (body.action === "sync_classes" || body.action === "sync_all") {
      results.classes = await syncClasses(organizationId, subsidiaryId, creds);
    }
    if (body.action === "sync_employees" || body.action === "sync_all") {
      results.employees = await syncEmployees(organizationId, creds);
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[admin/expenses POST]", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Error interno durante la sincronización",
    }, { status: 502 });
  }
}
