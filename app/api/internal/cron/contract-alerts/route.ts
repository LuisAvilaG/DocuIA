import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractCases, contractObligations } from "@/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";
import { isFeatureEnabled } from "@/lib/features";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

// Fires renewal/expiry alerts: any open obligation whose alert date has arrived
// is marked "alerted". (Delivery via email/webhook can hook in here.)
export async function GET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const due = await db.select({ id: contractObligations.id, organizationId: contractCases.organizationId })
      .from(contractObligations)
      .innerJoin(contractCases, eq(contractObligations.caseId, contractCases.id))
      .where(and(eq(contractObligations.status, "open"), lte(contractObligations.alertAt, now)))
      .limit(500);

    const orgIds = [...new Set(due.map((row) => row.organizationId))];
    const enabledByOrg = new Map(await Promise.all(orgIds.map(async (orgId) => [
      orgId, await isFeatureEnabled(orgId, "contract_obligation_tracking"),
    ] as const)));
    const eligibleIds = due.filter((row) => enabledByOrg.get(row.organizationId)).map((row) => row.id);

    if (eligibleIds.length > 0) {
      const result = await db.update(contractObligations)
        .set({ status: "alerted" })
        .where(and(inArray(contractObligations.id, eligibleIds), eq(contractObligations.status, "open"), lte(contractObligations.alertAt, now)));
      const count = (result as unknown as { rowCount?: number }).rowCount ?? eligibleIds.length;
      return NextResponse.json({ ok: true, alerted: count });
    }
    return NextResponse.json({ ok: true, alerted: 0 });
  } catch (err) {
    console.error("[cron/contract-alerts]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
