import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { withApiSecurity, contentDisposition } from "@/lib/security/http";
import { isOrgWordTemplateKey } from "@/lib/security/storage-key";
import { db } from "@/lib/db";
import { contractFlows, contractVisualTrainingVariants } from "@/db/schema";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { flowTransferSchema } from "@/lib/contracts/flow-transfer";
import { getFileBuffer } from "@/lib/storage/minio";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const [product, feature] = await Promise.all([
    isProductActive(session.orgId, "contract_intelligence"),
    isFeatureEnabled(session.orgId, "contract_flow_builder"),
  ]);
  if (!product || !feature) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });

  const { id } = await params;
  const flow = await db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, session.orgId)),
    columns: { name: true, graphJson: true },
  });
  if (!flow) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });
  const graph = flowGraphSchema.safeParse(flow.graphJson);
  if (!graph.success) return NextResponse.json({ error: "El flujo guardado no es válido" }, { status: 400 });
  const variants = await db.query.contractVisualTrainingVariants.findMany({
    where: and(eq(contractVisualTrainingVariants.organizationId, session.orgId), eq(contractVisualTrainingVariants.flowId, id)),
  });
  if (variants.length > 40) return NextResponse.json({ error: "El flujo tiene demasiadas variantes para exportarlo en un solo archivo." }, { status: 413 });

  let totalBytes = 0;
  async function readAsset(key: string) {
    const buffer = await getFileBuffer(key, MAX_ASSET_BYTES);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("El flujo y sus archivos superan 48 MB. Reduce las muestras visuales antes de exportarlo.");
    return buffer.toString("base64");
  }

  try {
    const assets: Array<Record<string, unknown>> = [];
    const portableGraph = structuredClone(graph.data);
    for (const node of portableGraph.nodes) {
      if (node.kind !== "generate" || !node.data.wordTemplate) continue;
      if (!isOrgWordTemplateKey(node.data.wordTemplate.storageKey, session.orgId)) {
        return NextResponse.json({ error: "La plantilla Word no pertenece a este cliente." }, { status: 400 });
      }
      assets.push({ kind: "word", nodeId: node.id, contentBase64: await readAsset(node.data.wordTemplate.storageKey) });
      node.data.wordTemplate.storageKey = "portable";
    }
    for (const variant of variants) {
      if (!variant.storageKey.startsWith(`contracts/${session.orgId}/flow-training/${id}/`)) {
        return NextResponse.json({ error: "Una muestra visual no pertenece a este flujo." }, { status: 400 });
      }
      assets.push({
        kind: "visual_variant", documentType: variant.documentType, name: variant.name,
        originalName: variant.originalName || "muestra.pdf", mimeType: variant.mimeType,
        signatureText: variant.signatureText, mappings: variant.mappingsJson,
        isActive: variant.isActive, contentBase64: await readAsset(variant.storageKey),
      });
    }
    const portable = flowTransferSchema.safeParse({ format: "docuia-contract-flow", version: 1, name: flow.name, graph: portableGraph, assets });
    if (!portable.success) return NextResponse.json({ error: "No se pudo preparar el flujo para exportación." }, { status: 400 });
    const safeName = flow.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "flujo";
    return NextResponse.json(portable.data, { headers: {
      "Content-Disposition": contentDisposition("attachment", `${safeName}.docuia-flow.json`),
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("El flujo y sus archivos") ? error.message : "No se pudieron leer los archivos del flujo.";
    return NextResponse.json({ error: message }, { status: message.startsWith("El flujo y sus archivos") ? 413 : 500 });
  }
}

export const GET = withApiSecurity(handleGET);
