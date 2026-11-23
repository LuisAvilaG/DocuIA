import { getErpExpenses } from "@/lib/erp";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { operatingOrganization } from "@/lib/auth/jwt";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("x-cron-secret") === secret;
}

async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Only clients that may operate, like the other crons.
    const orgs = await db.query.organizations.findMany({
      where: operatingOrganization(),
      columns: { id: true, activeNsEnvironment: true },
    });
    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      if (!await isFeatureEnabled(org.id, "expense_management")) continue;
      const feature = await getFeature(org.id, "expense_categories_sync");
      if (!feature.isEnabled) continue;

      const erp = await getErpExpenses(org.id);
      if (!erp) {
        summary[org.id] = { skipped: "no ERP connected that handles expenses" };
        continue;
      }

      try {
        // Inside the try: damaged credentials of one client (read when the call
        // is made) must not stop the rest.
        const [categories, departments, classes, employees] = await Promise.all([
          erp.syncCategories(org.id, null),
          erp.syncDepartments(org.id, null),
          erp.syncClasses(org.id, null),
          erp.syncEmployees(org.id),
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

export const GET = withApiSecurity(handleGET);
