import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations, historyDocuments, workflowRuntimeLogs } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { getFeature } from "@/lib/features";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({
      columns: { id: true },
    });

    const summary: Record<string, { history: number; logs: number }> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "data_retention");
      } catch {
        continue;
      }
      if (!feat.isEnabled) continue;

      const config = feat.config as {
        history_retention_days?: number;
        logs_retention_days?:    number;
      };

      const historyDays = config.history_retention_days ?? -1;
      const logsDays    = config.logs_retention_days    ?? 90;

      let historyDeleted = 0;
      let logsDeleted    = 0;

      if (historyDays > 0) {
        const cutoff = new Date(Date.now() - historyDays * 86400_000);
        const result = await db.delete(historyDocuments)
          .where(and(
            eq(historyDocuments.organizationId, org.id),
            lt(historyDocuments.createdAt, cutoff),
            eq(historyDocuments.status, "completed"),
          ));
        historyDeleted = (result as any).rowCount ?? 0;
      }

      if (logsDays > 0) {
        const cutoff = new Date(Date.now() - logsDays * 86400_000);
        const result = await db.delete(workflowRuntimeLogs)
          .where(and(
            eq(workflowRuntimeLogs.organizationId, org.id),
            lt(workflowRuntimeLogs.createdAt, cutoff),
          ));
        logsDeleted = (result as any).rowCount ?? 0;
      }

      summary[org.id] = { history: historyDeleted, logs: logsDeleted };
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/retention]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
