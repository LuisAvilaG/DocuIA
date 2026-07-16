import { buildOAuthHeader, NSCredentials } from "@/lib/netsuite/oauth";
import { db } from "@/lib/db";
import { expenseCategories, catalogDepartments, catalogClasses, orgUsers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { hashSync } from "bcryptjs";

// ── SuiteQL helper ────────────────────────────────────────────────────

function buildSuiteQLUrl(accountId: string): string {
  const normalizedId = accountId.replace(/_/g, "-").toLowerCase();
  return `https://${normalizedId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

interface SuiteQLRow { [key: string]: string | number | boolean | null }

async function runSuiteQL(
  creds: NSCredentials,
  query: string,
  offset = 0,
  limit = 1000,
): Promise<{ rows: SuiteQLRow[]; hasMore: boolean; totalResults: number }> {
  const url = `${buildSuiteQLUrl(creds.accountId)}?limit=${limit}&offset=${offset}`;
  const authHeader = buildOAuthHeader(url, "POST", creds);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SuiteQL error HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return {
    rows: (json.items ?? []) as SuiteQLRow[],
    hasMore: json.hasMore ?? false,
    totalResults: json.totalResults ?? 0,
  };
}

async function runSuiteQLAll(creds: NSCredentials, query: string): Promise<SuiteQLRow[]> {
  const all: SuiteQLRow[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { rows, hasMore } = await runSuiteQL(creds, query, offset, limit);
    all.push(...rows);
    if (!hasMore) break;
    offset += limit;
  }
  return all;
}

// ── Sync expense categories ───────────────────────────────────────────

export interface SyncResult {
  synced: number;
  errors: string[];
}

export async function syncExpenseCategories(
  orgId: string,
  subsidiaryId: string | null,
  creds: NSCredentials,
): Promise<SyncResult> {
  // expenseacct = internal ID of the GL account linked to this category
  // JOIN account to get display name (acctnumber + fullname)
  const rows = await runSuiteQLAll(
    creds,
    `SELECT ec.id, ec.name, ec.expenseacct,
            a.acctnumber, a.fullname AS accountfullname
     FROM expensecategory ec
     LEFT OUTER JOIN account a ON a.id = ec.expenseacct
     WHERE ec.isinactive = 'F'`,
  );

  let synced = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const accountDisplay = row.acctnumber && row.accountfullname
        ? `${row.acctnumber} ${row.accountfullname}`
        : (row.accountfullname ?? row.acctnumber ?? null);

      await db.insert(expenseCategories).values({
        organizationId:      orgId,
        subsidiaryId:        subsidiaryId ?? null,
        netsuiteCategoryId:  String(row.id),
        netsuiteAccountId:   row.expenseacct != null ? String(row.expenseacct) : null,
        netsuiteAccountName: accountDisplay != null ? String(accountDisplay) : null,
        name:                String(row.name),
        isActive:            true,
        syncedAt:            new Date(),
        updatedAt:           new Date(),
      }).onConflictDoUpdate({
        target: [expenseCategories.organizationId, expenseCategories.netsuiteCategoryId],
        set: {
          name:                String(row.name),
          netsuiteAccountId:   row.expenseacct != null ? String(row.expenseacct) : null,
          netsuiteAccountName: accountDisplay != null ? String(accountDisplay) : null,
          isActive:            true,
          syncedAt:            new Date(),
          updatedAt:           new Date(),
        },
      });
      synced++;
    } catch (e) {
      errors.push(`category ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, errors };
}

// ── Sync departments ──────────────────────────────────────────────────

export async function syncDepartments(
  orgId: string,
  subsidiaryId: string | null,
  creds: NSCredentials,
): Promise<SyncResult> {
  const rows = await runSuiteQLAll(
    creds,
    `SELECT id, name FROM department WHERE isinactive = 'F'`,
  );

  let synced = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      await db.insert(catalogDepartments).values({
        organizationId: orgId,
        subsidiaryId:   subsidiaryId ?? null,
        netsuiteId:     String(row.id),
        name:           String(row.name),
        isInactive:     false,
        updatedAt:      new Date(),
      }).onConflictDoUpdate({
        target: [catalogDepartments.organizationId, catalogDepartments.netsuiteId],
        set: {
          name:      String(row.name),
          isInactive: false,
          updatedAt: new Date(),
        },
      });
      synced++;
    } catch (e) {
      errors.push(`department ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, errors };
}

// ── Sync classes / UT ─────────────────────────────────────────────────

export async function syncClasses(
  orgId: string,
  subsidiaryId: string | null,
  creds: NSCredentials,
): Promise<SyncResult> {
  const rows = await runSuiteQLAll(
    creds,
    `SELECT id, name FROM classification WHERE isinactive = 'F'`,
  );

  let synced = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      await db.insert(catalogClasses).values({
        organizationId: orgId,
        subsidiaryId:   subsidiaryId ?? null,
        netsuiteId:     String(row.id),
        name:           String(row.name),
        isInactive:     false,
        updatedAt:      new Date(),
      }).onConflictDoUpdate({
        target: [catalogClasses.organizationId, catalogClasses.netsuiteId],
        set: {
          name:      String(row.name),
          isInactive: false,
          updatedAt: new Date(),
        },
      });
      synced++;
    } catch (e) {
      errors.push(`class ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, errors };
}

// ── Sync employees → expense_submitter users ──────────────────────────

export interface SyncEmployeesResult {
  created: number;
  updated: number;
  errors: string[];
}

export async function syncEmployees(
  orgId: string,
  creds: NSCredentials,
): Promise<SyncEmployeesResult> {
  const rows = await runSuiteQLAll(
    creds,
    `SELECT id, email, firstname, lastname FROM employee WHERE isinactive = 'F' AND email IS NOT NULL`,
  );

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.email) continue;
    const email    = String(row.email).toLowerCase().trim();
    const fullName = [row.firstname, row.lastname].filter(Boolean).join(" ") || null;
    const nsId     = String(row.id);

    try {
      const existing = await db.query.orgUsers.findFirst({
        where: and(eq(orgUsers.organizationId, orgId), eq(orgUsers.email, email)),
        columns: { id: true, netsuiteEmployeeId: true },
      });

      if (existing) {
        await db.update(orgUsers)
          .set({ netsuiteEmployeeId: nsId, fullName: fullName ?? undefined, updatedAt: new Date() })
          .where(eq(orgUsers.id, existing.id));
        updated++;
      } else {
        const tempPassword = randomUUID().slice(0, 12);
        await db.insert(orgUsers).values({
          id:                 randomUUID(),
          organizationId:     orgId,
          email,
          fullName,
          role:               "expense_submitter",
          passwordHash:       hashSync(tempPassword, 12),
          isActive:           true,
          netsuiteEmployeeId: nsId,
          createdAt:          new Date(),
          updatedAt:          new Date(),
        });
        created++;
      }
    } catch (e) {
      errors.push(`employee ${row.id} (${email}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { created, updated, errors };
}
