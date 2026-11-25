import { redirect } from "next/navigation";
import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { approvalMaps, contractCases } from "@/db/schema";
import { approvalEditorContext, mapContextFrom } from "@/lib/approval-map/admin";
import { mapGraphSchema, questionLabel, validateMap, type MapNode } from "@/lib/approval-map/engine";
import { MapsClient, type FlowOption, type MapRow } from "./maps-client";

type Question = Extract<MapNode, { type: "question" }>;

/** «Valor del contrato» → «valor del contrato»; deja intactas las siglas («IVA»). */
function lowerFirst(text: string): string {
  return text.length > 1 && text[1] === text[1].toLowerCase() ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Por qué pregunta el mapa, para las etiquetas de la lista. */
function askedAbout(node: Question, fieldLabels: Map<string, string>): string {
  const subject = node.data.subject;
  if (subject.kind === "flow") return "tipo de contrato";
  if (subject.kind === "analysis") return "hallazgos";
  const label = fieldLabels.get(`${subject.docType}\u0000${subject.field}`);
  return lowerFirst(label ?? questionLabel(node.data));
}

export default async function ApprovalMapsPage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_approval_rules"))) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/cases");

  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [ctx, rows, recent] = await Promise.all([
    approvalEditorContext(session.orgId),
    db.query.approvalMaps.findMany({
      where: eq(approvalMaps.organizationId, session.orgId),
      columns: { id: true, name: true, draftJson: true, publishedJson: true, version: true },
      orderBy: (m, { asc }) => [asc(m.name)],
    }),
    // Casos de los últimos 30 días por flujo: los flujos sin mapa que más se usan van primero.
    db.select({ flowId: contractCases.flowId, n: count() }).from(contractCases)
      .where(and(eq(contractCases.organizationId, session.orgId), isNotNull(contractCases.flowId), gte(contractCases.createdAt, since)))
      .groupBy(contractCases.flowId),
  ]);
  const recentCases = new Map(recent.map((r) => [r.flowId, Number(r.n)]));
  const mapCtx = mapContextFrom(ctx);
  const fieldLabels = new Map(ctx.docTypes.flatMap((d) => d.fields.map((f) => [`${d.key}\u0000${f.key}`, f.label] as const)));

  const maps: MapRow[] = rows.map((row) => {
    const parsed = mapGraphSchema.safeParse(row.draftJson);
    const flows = ctx.flows.filter((f) => f.approvalMapId === row.id);
    const unpublished = row.version > 0 && JSON.stringify(row.draftJson) !== JSON.stringify(row.publishedJson ?? null);
    if (!parsed.success) {
      return {
        id: row.id, name: row.name, version: row.version, unpublished,
        flowIds: flows.map((f) => f.id), flowNames: flows.map((f) => f.name), asks: [],
        issue: { level: "error", message: "No se pudo leer el borrador de este mapa." }, moreIssues: 0,
        drawing: { nodes: [], edges: [] },
      };
    }
    const graph = parsed.data;
    const issues = validateMap(graph, mapCtx).sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
    const asks = [...new Set(graph.nodes.filter((n): n is Question => n.type === "question").map((n) => askedAbout(n, fieldLabels)))];
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      unpublished,
      flowIds: flows.map((f) => f.id),
      flowNames: flows.map((f) => f.name),
      asks,
      issue: issues[0] ? { level: issues[0].level, message: issues[0].message } : null,
      moreIssues: Math.max(0, issues.length - 1),
      drawing: {
        nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, x: n.position.x, y: n.position.y })),
        edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      },
    };
  });

  const mapNames = new Map(rows.map((r) => [r.id, r.name]));
  const flows: FlowOption[] = ctx.flows.map((f) => ({
    id: f.id,
    name: f.name,
    isActive: f.isActive,
    mapId: f.approvalMapId && mapNames.has(f.approvalMapId) ? f.approvalMapId : null,
    mapName: f.approvalMapId ? mapNames.get(f.approvalMapId) ?? null : null,
    recentCases: recentCases.get(f.id) ?? 0,
  }));

  return <MapsClient maps={maps} flows={flows} />;
}
