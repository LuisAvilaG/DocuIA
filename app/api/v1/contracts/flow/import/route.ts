import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { withApiSecurity } from "@/lib/security/http";
import { validateDocx } from "@/lib/security/docx";
import { matchesFileType } from "@/lib/security/files";
import { db } from "@/lib/db";
import { contractFlows, contractVisualTrainingVariants } from "@/db/schema";
import { getContractFlowCount, getContractFlowLimit } from "@/lib/contracts/plan";
import { decodeAsset, validateFlowTransfer } from "@/lib/contracts/flow-transfer";
import { deleteFile, uploadFile } from "@/lib/storage/minio";

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE_BYTES = 70 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 48 * 1024 * 1024;

async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const [product, feature, limit, current] = await Promise.all([
    isProductActive(session.orgId, "contract_intelligence"),
    isFeatureEnabled(session.orgId, "contract_flow_builder"),
    getContractFlowLimit(session.orgId), getContractFlowCount(session.orgId),
  ]);
  if (!product || !feature) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });
  if (current >= limit) return NextResponse.json({ error: `Alcanzaste el máximo de ${limit} flujo(s) para este cliente.` }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docuia-flow.json")) {
    return NextResponse.json({ error: "Selecciona un archivo .docuia-flow.json exportado desde DocuIA." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "El archivo de flujo debe pesar máximo 70 MB." }, { status: 413 });
  const parsedJson: unknown = await file.text().then((text) => JSON.parse(text)).catch(() => null);
  const result = validateFlowTransfer(parsedJson);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const portable = result.package;
  const prepared: Array<{ key: string; mimeType: string; bytes: Buffer }> = [];
  const flowId = randomUUID();
  const graph = structuredClone(portable.graph);
  const variantRows: Array<typeof contractVisualTrainingVariants.$inferInsert> = [];
  let totalBytes = 0;
  for (const asset of portable.assets) {
    const bytes = decodeAsset(asset.contentBase64, MAX_ASSET_BYTES);
    if (!bytes) return NextResponse.json({ error: "Uno de los archivos del flujo está dañado o supera 20 MB." }, { status: 400 });
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ASSET_BYTES) return NextResponse.json({ error: "Los archivos del flujo superan 48 MB." }, { status: 413 });
    if (asset.kind === "word") {
      try { await validateDocx(bytes); }
      catch { return NextResponse.json({ error: "La plantilla Word importada no es válida." }, { status: 400 }); }
      const node = graph.nodes.find((entry) => entry.id === asset.nodeId && entry.kind === "generate");
      if (!node || node.kind !== "generate" || !node.data.wordTemplate) return NextResponse.json({ error: "La plantilla Word no corresponde a un nodo de generación." }, { status: 400 });
      const key = `contracts/${session.orgId}/flows/${flowId}/word-templates/${randomUUID()}-${node.data.wordTemplate.originalName.replace(/[^\w.()-]+/g, "-")}`;
      node.data.wordTemplate.storageKey = key;
      prepared.push({ key, mimeType: WORD_MIME, bytes });
    } else {
      if (!matchesFileType(bytes, asset.mimeType)) return NextResponse.json({ error: "Una muestra visual no coincide con su tipo de archivo." }, { status: 400 });
      const variantId = randomUUID();
      const safeName = asset.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "muestra";
      const key = `contracts/${session.orgId}/flow-training/${flowId}/${variantId}-${safeName}`;
      prepared.push({ key, mimeType: asset.mimeType, bytes });
      variantRows.push({
        id: variantId, organizationId: session.orgId, flowId, documentType: asset.documentType,
        name: asset.name, storageKey: key, originalName: asset.originalName,
        mimeType: asset.mimeType, signatureText: asset.signatureText,
        mappingsJson: asset.mappings, isActive: asset.isActive,
      });
    }
  }

  const uploaded: string[] = [];
  try {
    for (const asset of prepared) {
      await uploadFile(asset.bytes, asset.key, asset.mimeType);
      uploaded.push(asset.key);
    }
    await db.transaction(async (tx) => {
      await tx.insert(contractFlows).values({
        id: flowId, organizationId: session.orgId, name: portable.name,
        graphJson: graph, isActive: false,
      });
      if (variantRows.length) await tx.insert(contractVisualTrainingVariants).values(variantRows);
    });
    return NextResponse.json({ ok: true, id: flowId, name: portable.name, isActive: false }, { status: 201 });
  } catch (error) {
    console.error("[contracts/flow import]", error);
    await Promise.allSettled(uploaded.map((key) => deleteFile(key)));
    return NextResponse.json({ error: "No se pudo importar el flujo. No se creó ningún borrador." }, { status: 500 });
  }
}

export const POST = withApiSecurity(handlePOST);
