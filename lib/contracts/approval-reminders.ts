// Recordatorio a quien debe decidir un caso (feature contract_approval_rules).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, orgFeatures, orgUsers } from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { caseApprovalRules } from "./approval-state";

/** Días hábiles (lunes a viernes) completos entre dos fechas. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));

export async function sendApprovalReminders(now = new Date()): Promise<{ checked: number; sent: number }> {
  const orgs = await db.select({ organizationId: orgFeatures.organizationId }).from(orgFeatures)
    .where(and(eq(orgFeatures.featureId, "contract_approval_rules"), eq(orgFeatures.adminGranted, true)));
  const orgIds = orgs.map((o) => o.organizationId);
  if (orgIds.length === 0) return { checked: 0, sent: 0 };

  const cases = await db.query.contractCases.findMany({
    where: and(inArray(contractCases.organizationId, orgIds), eq(contractCases.status, "validated")),
    columns: { id: true, organizationId: true, title: true, updatedAt: true, resultJson: true },
    limit: 500,
  });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let sent = 0;
  for (const c of cases) {
    const rules = await caseApprovalRules(c.organizationId, c.id).catch(() => null);
    if (!rules || rules.reminderBusinessDays <= 0) continue;
    const result = (c.resultJson ?? {}) as { lastReminderAt?: string };
    const since = result.lastReminderAt ? new Date(result.lastReminderAt) : c.updatedAt;
    if (businessDaysBetween(since, now) < rules.reminderBusinessDays) continue;

    const pending = rules.steps.find((st) => !rules.done.some((d) => d.stepKey === st.key));
    if (!pending) continue;
    const people = await db.query.orgUsers.findMany({
      where: and(eq(orgUsers.organizationId, c.organizationId), eq(orgUsers.isActive, true),
        pending.approvers.mode === "users" && pending.approvers.userIds.length
          ? inArray(orgUsers.id, pending.approvers.userIds)
          : inArray(orgUsers.role, ["admin", "approver"])),
      columns: { email: true },
    });
    const to = people.map((p) => p.email).filter(Boolean);
    if (to.length === 0) continue;
    const title = c.title ?? "Caso sin título";
    const link = appUrl ? `${appUrl}/contracts/${c.id}?etapa=dec` : null;
    const html = `<p>El caso <b>${esc(title)}</b> espera la aprobación «${esc(pending.label)}».</p>${link ? `<p><a href="${link}">Abrir el caso</a></p>` : ""}<p style="color:#6B6F7E;font-size:13px">Recibes este recordatorio porque puedes decidir este caso en DocuIA.</p>`;
    const results = await Promise.all(to.map((email) => sendEmail({ to: email, subject: `Un caso espera tu decisión: ${title}`, html })));
    if (results.some((r) => r.ok)) {
      sent++;
      // Solo se toca la marca del recordatorio, sobre el valor actual: el caso pudo
      // recibir una firma o una decisión mientras se enviaban los correos.
      await db.update(contractCases)
        .set({ resultJson: sql`(coalesce(${contractCases.resultJson}::jsonb, '{}'::jsonb) || ${JSON.stringify({ lastReminderAt: now.toISOString() })}::jsonb)::json` })
        .where(and(eq(contractCases.id, c.id), eq(contractCases.status, "validated")));
    }
  }
  return { checked: cases.length, sent };
}
