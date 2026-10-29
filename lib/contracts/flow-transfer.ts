import { z } from "zod";
import { flowGraphSchema, hasCycle, validateFlowReferences } from "./flow";

const mappingSchema = z.object({
  fieldKey: z.string().min(1).max(120),
  page: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  anchorText: z.string().max(500).optional(),
});

const wordAssetSchema = z.object({
  kind: z.literal("word"),
  nodeId: z.string().min(1),
  contentBase64: z.string().min(1),
});

const variantAssetSchema = z.object({
  kind: z.literal("visual_variant"),
  documentType: z.string().min(1).max(60),
  name: z.string().min(1).max(150),
  originalName: z.string().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  signatureText: z.string().max(4000).nullable(),
  mappings: z.array(mappingSchema).max(120),
  isActive: z.boolean(),
  contentBase64: z.string().min(1),
});

export const flowTransferSchema = z.object({
  format: z.literal("docuia-contract-flow"),
  version: z.literal(1),
  name: z.string().min(1).max(150),
  graph: flowGraphSchema,
  assets: z.array(z.discriminatedUnion("kind", [wordAssetSchema, variantAssetSchema])).max(40),
});

export type FlowTransfer = z.infer<typeof flowTransferSchema>;

export function validateFlowTransfer(value: unknown): { package: FlowTransfer } | { error: string } {
  const parsed = flowTransferSchema.safeParse(value);
  if (!parsed.success) return { error: "El archivo no es un flujo de DocuIA compatible." };
  const content = parsed.data;
  if (hasCycle(content.graph)) return { error: "El flujo importado contiene un ciclo." };
  const referencesError = validateFlowReferences(content.graph);
  if (referencesError) return { error: referencesError };

  const wordNodes = content.graph.nodes.filter((node) => node.kind === "generate" && node.data.wordTemplate);
  const wordAssets = content.assets.filter((asset) => asset.kind === "word");
  if (wordNodes.length !== wordAssets.length ||
      wordNodes.some((node) => !wordAssets.some((asset) => asset.nodeId === node.id)) ||
      new Set(wordAssets.map((asset) => asset.nodeId)).size !== wordAssets.length) {
    return { error: "Falta una plantilla Word del flujo o hay plantillas duplicadas." };
  }
  const intakeTypes = new Set(content.graph.nodes.filter((node) => node.kind === "intake").map((node) => node.data.docTypeKey));
  if (content.assets.some((asset) => asset.kind === "visual_variant" && !intakeTypes.has(asset.documentType))) {
    return { error: "Una variante visual corresponde a un documento que no existe en el flujo." };
  }
  return { package: content };
}

export function decodeAsset(contentBase64: string, maxBytes: number): Buffer | null {
  if (contentBase64.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) return null;
  const buffer = Buffer.from(contentBase64, "base64");
  return buffer.length > 0 && buffer.length <= maxBytes ? buffer : null;
}
