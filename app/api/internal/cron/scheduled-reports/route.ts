import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations, historyDocuments } from "@/db/schema";
import { and, eq, gte, count, sql } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { sendEmail } from "@/lib/email/send";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

function periodStart(frequency: string): Date {
  if (frequency === "monthly") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(Date.now() - 7 * 86_400_000);
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({
      columns: { id: true, name: true, billingEmail: true },
    });

    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "scheduled_reports");
      } catch { continue; }
      if (!feat.isEnabled) continue;

      const config = feat.config as { frequency?: string; recipients?: string };
      const frequency     = config.frequency ?? "weekly";
      const recipientsRaw = config.recipients ?? org.billingEmail ?? "";
      if (!recipientsRaw) { summary[org.id] = { skipped: "no recipients" }; continue; }

      const since        = periodStart(frequency);
      const periodLabel  = frequency === "monthly" ? "mensual" : "semanal";
      const periodRange  = frequency === "monthly"
        ? since.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
        : "últimos 7 días";

      const byStatus = await db
        .select({ status: historyDocuments.status, cnt: count() })
        .from(historyDocuments)
        .where(and(
          eq(historyDocuments.organizationId, org.id),
          gte(historyDocuments.createdAt, since),
        ))
        .groupBy(historyDocuments.status);

      const total     = byStatus.reduce((s, r) => s + Number(r.cnt), 0);
      const completed = Number(byStatus.find(r => r.status === "completed")?.cnt ?? 0);
      const failed    = Number(byStatus.find(r => r.status === "failed")?.cnt ?? 0);

      const topVendors = await db
        .select({ vendor: historyDocuments.vendor, cnt: count() })
        .from(historyDocuments)
        .where(and(
          eq(historyDocuments.organizationId, org.id),
          gte(historyDocuments.createdAt, since),
          eq(historyDocuments.status, "completed"),
        ))
        .groupBy(historyDocuments.vendor)
        .orderBy(sql`count(*) desc`)
        .limit(5);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.docuia.com";

      const vendorRows = topVendors
        .map(v => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${v.vendor ?? "—"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${v.cnt}</td>
        </tr>`)
        .join("");

      const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 4px">Reporte ${periodLabel} — ${org.name}</h2>
        <p style="color:#888;font-size:13px;margin:0 0 24px">${periodRange}</p>
        <div style="display:flex;gap:16px;margin:0 0 24px">
          <div style="flex:1;background:#f5f5f5;border-radius:8px;padding:16px;text-align:center">
            <p style="font-size:28px;font-weight:700;margin:0">${total}</p>
            <p style="font-size:12px;color:#888;margin:4px 0 0">Total documentos</p>
          </div>
          <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:16px;text-align:center">
            <p style="font-size:28px;font-weight:700;margin:0;color:#16a34a">${completed}</p>
            <p style="font-size:12px;color:#888;margin:4px 0 0">Completados</p>
          </div>
          <div style="flex:1;background:#fef2f2;border-radius:8px;padding:16px;text-align:center">
            <p style="font-size:28px;font-weight:700;margin:0;color:#dc2626">${failed}</p>
            <p style="font-size:12px;color:#888;margin:4px 0 0">Errores</p>
          </div>
        </div>
        ${topVendors.length > 0 ? `
        <h3 style="font-size:13px;font-weight:600;margin:0 0 8px">Proveedores con más documentos</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 24px">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #eee">Proveedor</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #eee">Docs</th>
          </tr></thead>
          <tbody>${vendorRows}</tbody>
        </table>` : ""}
        <a href="${appUrl}/history" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500;font-size:14px">
          Ver historial →
        </a>
        <p style="color:#bbb;font-size:11px;margin:24px 0 0">DocuIA — Reporte automático · Para dejar de recibirlo, contacta a tu administrador.</p>
      </div>`;

      const recipients = recipientsRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
      for (const to of recipients) {
        await sendEmail({
          to,
          subject: `Reporte ${periodLabel} — ${org.name}`,
          html,
        });
      }

      summary[org.id] = { sent: true, recipients: recipients.length, total, completed, failed };
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/scheduled-reports]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
