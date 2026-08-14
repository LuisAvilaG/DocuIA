import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { nsConnections } from "@/db/schema";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { decryptField } from "@/lib/crypto/encrypt";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import {
  syncClasses,
  syncDepartments,
  syncEmployees,
  syncExpenseCategories,
} from "@/lib/expense/sync-catalogs";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orgs = await db.query.organizations.findMany({
      columns: { id: true, activeNsEnvironment: true },
    });
    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      if (!await isFeatureEnabled(org.id, "expense_management")) continue;
      const feature = await getFeature(org.id, "expense_categories_sync");
      if (!feature.isEnabled) continue;

      const environment = org.activeNsEnvironment as "sandbox" | "production";
      const connection = await db.query.nsConnections.findFirst({
        where: and(
          eq(nsConnections.organizationId, org.id),
          eq(nsConnections.environment, environment),
          eq(nsConnections.isActive, true),
        ),
      });
      if (!connection) {
        summary[org.id] = { skipped: "no active NetSuite connection" };
        continue;
      }

      const credentials: NSCredentials = {
        accountId: connection.accountId,
        consumerKey: decryptField(connection.consumerKey),
        consumerSecret: decryptField(connection.consumerSecret),
        tokenId: decryptField(connection.tokenId),
        tokenSecret: decryptField(connection.tokenSecret),
      };

      try {
        const [categories, departments, classes, employees] = await Promise.all([
          syncExpenseCategories(org.id, null, credentials),
          syncDepartments(org.id, null, credentials),
          syncClasses(org.id, null, credentials),
          syncEmployees(org.id, credentials),
        ]);
        summary[org.id] = { categories, departments, classes, employees };
      } catch (error) {
        summary[org.id] = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[cron/expense-categories-sync]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
