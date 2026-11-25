// Mapa de aprobaciones: los «Aviso» del camino. Informan sin pedir firma, por
// correo, cuando el caso llega a ellos (todas las firmas anteriores hechas).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { caseApprovalRules } from "@/lib/contracts/approval-state";
import { loadApprovalPeople, whoLabel } from "./state";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));

/** Envía los avisos a los que el caso ya llegó y que no se enviaron. Nunca lanza. */
export async function dispatchRouteNotices(organizationId: string, caseId: string): Promise<number> {
  try {
    const people = await loadApprovalPeople(organizationId);
    const rules = await caseApprovalRules(organizationId, caseId, people);
    if (!rules?.map) return 0;
    const kase = await db.query.contractCases.findFirst({
      where: and(eq(contractCases.id, caseId), eq(contractCases.organizationId, organizationId)),
      columns: { title: true, status: true, resultJson: true },
    });
    if (!kase || !["validated", "approved", "generated"].includes(kase.status)) return 0;
    const sentBefore = new Set(((kase.resultJson ?? {}) as { mapNotices?: string[] }).mapNotices ?? []);
    const signedKeys = new Set(rules.done.map((d) => d.stepKey));
    const approved = kase.status !== "validated";
    const due: Array<{ key: string; to: string[]; label: string }> = [];
    for (const step of rules.map.route) {
      if (step.kind === "wait") break;
      if (step.kind === "sign") {
        if (!signedKeys.has(step.key) && !approved) break;
        continue;
      }
      if (sentBefore.has(step.key) || !step.who) continue;
      const ids = step.who.kind === "role" ? people.roles.get(step.who.roleId)?.memberIds ?? [] : [step.who.userId];
      const to = ids.map((id) => people.emails.get(id)).filter((email): email is string => Boolean(email));
      due.push({ key: step.key, to, label: whoLabel(step.who, people) });
    }
    if (!due.length) return 0;
    const title = kase.title ?? "Caso sin título";
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const link = appUrl ? `${appUrl}/contracts/${caseId}` : null;
    for (const notice of due) {
      const html = `<p>El caso <b>${esc(title)}</b> pasó por tu aviso en el mapa de aprobaciones «${esc(rules.map.map.name)}».</p><p>No necesitas firmar: es solo para que estés al tanto.</p>${link ? `<p><a href="${link}">Ver el caso</a></p>` : ""}`;
      await Promise.all(notice.to.map((email) => sendEmail({ to: email, subject: `Aviso: ${title}`, html })));
    }
    // Solo se agregan las marcas, sobre el valor actual del caso.
    const all = [...sentBefore, ...due.map((d) => d.key)];
    await db.update(contractCases)
      .set({ resultJson: sql`(coalesce(${contractCases.resultJson}::jsonb, '{}'::jsonb) || ${JSON.stringify({ mapNotices: all })}::jsonb)::json` })
      .where(and(eq(contractCases.id, caseId), inArray(contractCases.status, ["validated", "approved", "generated"])));
    return due.length;
  } catch (error) {
    console.warn("[approval-map] no se pudieron enviar los avisos", error instanceof Error ? error.message : error);
    return 0;
  }
}
