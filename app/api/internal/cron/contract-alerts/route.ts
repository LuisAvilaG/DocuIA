import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractObligations } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";

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
    const due = await db.query.contractObligations.findMany({
      where: and(eq(contractObligations.status, "open"), lte(contractObligations.alertAt, now)),
      columns: { id: true, caseId: true, type: true, dueDate: true },
      limit: 500,
    });

    if (due.length > 0) {
      const result = await db.update(contractObligations)
        .set({ status: "alerted" })
        .where(and(eq(contractObligations.status, "open"), lte(contractObligations.alertAt, now)));
      const count = (result as unknown as { rowCount?: number }).rowCount ?? due.length;
      return NextResponse.json({ ok: true, alerted: count });
    }
    return NextResponse.json({ ok: true, alerted: 0 });
  } catch (err) {
    console.error("[cron/contract-alerts]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
