import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMaps, contractCases, contractDocuments, contractFlows } from "@/db/schema";
import { approvalMapAdmin, readJson } from "@/lib/approval-map/admin";
import { evaluateRoute, mapGraphSchema, resolveSigners, type DocsByTypeLike } from "@/lib/approval-map/engine";
import { loadApprovalPeople, whoLabel } from "@/lib/approval-map/state";
import { newestFirst } from "@/lib/contracts/validate";
import { fieldLabelsFromFlows } from "@/lib/approval-map/labels";

/**
 * Probar el mapa (el que está en pantalla, aunque no se haya guardado) con un
 * caso descrito a mano o con uno por decidir: el camino, quién firmaría cada
 * paso y por qué. No guarda nada.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await approvalMapAdmin(false);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const { id } = await params;
  const map = await db.query.approvalMaps.findFirst({ where: and(eq(approvalMaps.id, id), eq(approvalMaps.organizationId, session.orgId)), columns: { draftJson: true } });
  if (!map) return NextResponse.json({ error: "Mapa no encontrado" }, { status: 404 });
  const body = await readJson(req);
  const graph = mapGraphSchema.safeParse(body.draft ?? map.draftJson);
  if (!graph.success) return NextResponse.json({ error: "El mapa no tiene una forma válida." }, { status: 400 });

  let flowId = typeof body.flowId === "string" ? body.flowId : null;
  let creatorId = typeof body.creatorId === "string" && body.creatorId ? body.creatorId : null;
  let verdict: "ok" | "warn" | "block" = body.verdict === "block" || body.verdict === "warn" ? body.verdict : "ok";
  const docs: DocsByTypeLike = {};
  if (typeof body.caseId === "string" && body.caseId) {
    const kase = await db.query.contractCases.findFirst({ where: and(eq(contractCases.id, body.caseId), eq(contractCases.organizationId, session.orgId)), columns: { flowId: true, createdBy: true, resultJson: true } });
    if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
    flowId = kase.flowId;
    creatorId = kase.createdBy;
    const stored = (kase.resultJson as { verdict?: string } | null)?.verdict;
    verdict = stored === "block" || stored === "warn" ? stored : "ok";
    const rows = await db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, body.caseId), columns: { id: true, createdAt: true, detectedType: true, extractedJson: true } });
    for (const row of newestFirst(rows)) if (row.detectedType) (docs[row.detectedType] ??= []).push({ values: (row.extractedJson ?? {}) as Record<string, unknown> });
  } else if (body.values && typeof body.values === "object") {
    // «contrato.valor»: «2.500 millones»
    for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
      const [docType, field] = key.split(".");
      if (!docType || !field || typeof value !== "string" || !value.trim()) continue;
      ((docs[docType] ??= [{ values: {} }])[0].values)[field] = value.trim().slice(0, 200);
    }
  }

  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? new Date(`${body.date}T12:00:00Z`) : new Date();
  const people = await loadApprovalPeople(session.orgId, date);
  const flows = await db.query.contractFlows.findMany({ where: eq(contractFlows.organizationId, session.orgId), columns: { id: true, name: true, graphJson: true } });
  const route = evaluateRoute(graph.data, { flowId, docs, verdict }, new Map(flows.map((f) => [f.id, f.name])), fieldLabelsFromFlows(flows.map((f) => f.graphJson)));
  const steps = route.steps.map((step) => {
    const label = step.kind === "wait" ? "Falta un dato" : whoLabel(step.who, people);
    if (step.kind !== "sign") {
      const ids = step.kind === "notify" && step.who ? (step.who.kind === "role" ? people.roles.get(step.who.roleId)?.memberIds ?? [] : [step.who.userId]) : [];
      return { key: step.key, kind: step.kind, label, names: ids.map((uid) => people.names.get(uid) ?? "—"), note: null, reason: step.reason ?? null };
    }
    const signers = resolveSigners(step.who, { roles: people.roles, signers: people.signers, admins: people.admins, creatorId, absent: people.absentToday, alreadySigned: new Set(), escalated: false, names: people.names });
    return { key: step.key, kind: step.kind, label, names: signers.userIds.map((uid) => people.names.get(uid) ?? "—"), note: signers.note, reason: null };
  });
  return NextResponse.json({ steps, answers: route.answers, problem: route.problem, visited: route.answers.map((a) => a.nodeId).concat(route.steps.map((s) => s.key)) });
}

export const POST = withApiSecurity(handlePOST);
