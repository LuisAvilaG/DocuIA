import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { historyDocuments, orgFeatures } from "@/db/schema";
import { and, eq, gte, lt, count, inArray, sql } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { sendEmail } from "@/lib/email/send";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

/**
 * The period a report covers: the week or month that just ended. `until` is the
 * start of the current one, which also identifies the report already sent.
 */
function reportWindow(frequency: string, now = new Date()): { from: Date; until: Date } {
  if (frequency === "monthly") {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), until: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  const day = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
  return { from: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7), until: monday };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));

function reportTypes(scope: string): Array<"invoice" | "purchase_order"> {
  if (scope === "invoice") return ["invoice"];
  if (scope === "purchase_order") return ["purchase_order"];
  return ["invoice", "purchase_order"];
}

async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({
      where: (o, { inArray }) => inArray(o.status, ["active", "trial"]),
      columns: { id: true, name: true, billingEmail: true },
    });

    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "scheduled_reports");
      } catch { continue; }
      if (!feat.isEnabled) continue;

      const config = feat.config as { frequency?: string; recipients?: string; report_scope?: string; last_sent_period?: string };
      const frequency     = config.frequency ?? "weekly";
      const recipientsRaw = config.recipients ?? org.billingEmail ?? "";
      if (!recipientsRaw) { summary[org.id] = { skipped: "no recipients" }; continue; }

      const { from: since, until } = reportWindow(frequency);
      const periodKey    = frequency === "monthly"
        ? `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}`
        : until.toISOString().slice(0, 10);
      if (config.last_sent_period === periodKey) {
        summary[org.id] = { skipped: "already sent for current period" };
        continue;
      }
      const documentTypes = reportTypes(config.report_scope ?? "all");
      const periodLabel  = frequency === "monthly" ? "mensual" : "semanal";
      const periodRange  = frequency === "monthly"
        ? since.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
        : `${since.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} al ${new Date(until.getTime() - 86_400_000).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`;

      const byStatus = await db
        .select({ status: historyDocuments.status, cnt: count() })
        .from(historyDocuments)
        .where(and(
          eq(historyDocuments.organizationId, org.id),
          gte(historyDocuments.createdAt, since),
          lt(historyDocuments.createdAt, until),
          inArray(historyDocuments.documentType, documentTypes),
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
          lt(historyDocuments.createdAt, until),
          inArray(historyDocuments.documentType, documentTypes),
          eq(historyDocuments.status, "completed"),
        ))
        .groupBy(historyDocuments.vendor)
        .orderBy(sql`count(*) desc`)
        .limit(5);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.docuia.com";

      const vendorRows = topVendors
        .map(v => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(v.vendor ?? "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${v.cnt}</td>
        </tr>`)
        .join("");

      const html = `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 4px">Reporte ${periodLabel} — ${esc(org.name)}</h2>
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
      let delivered = 0;
      for (const to of recipients) {
        const r = await sendEmail({
          to,
          subject: `Reporte ${periodLabel} — ${org.name}`,
          html,
        });
        if (r.ok) delivered++;
      }
      // Nothing went out: leave the period open so tomorrow's run tries again.
      if (delivered === 0) { summary[org.id] = { sent: false, error: "no se pudo enviar el correo" }; continue; }

      const [override] = await db.select({ configJson: orgFeatures.configJson })
        .from(orgFeatures)
        .where(and(eq(orgFeatures.organizationId, org.id), eq(orgFeatures.featureId, "scheduled_reports")));
      await db.update(orgFeatures).set({
        configJson: { ...((override?.configJson ?? {}) as Record<string, unknown>), last_sent_period: periodKey },
      }).where(and(eq(orgFeatures.organizationId, org.id), eq(orgFeatures.featureId, "scheduled_reports")));

      summary[org.id] = { sent: true, recipients: recipients.length, scope: config.report_scope ?? "all", total, completed, failed };
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/scheduled-reports]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
