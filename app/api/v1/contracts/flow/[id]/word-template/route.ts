import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { contractFlows } from "@/db/schema";
import { getFileStream, uploadFile } from "@/lib/storage/minio";
import { flowGraphSchema } from "@/lib/contracts/flow";
import { isWordTemplate, type WordTemplateConfig } from "@/lib/contracts/word-template";

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function guard() {
  const session = await getTenantSession();
  if (!session) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) } as const;
  if (session.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores pueden gestionar plantillas Word." }, { status: 403 }) } as const;
  const [product, flows] = await Promise.all([
    isProductActive(session.orgId, "contract_intelligence"),
    isFeatureEnabled(session.orgId, "contract_flow_builder"),
  ]);
  if (!product || !flows) return { error: NextResponse.json({ error: "El constructor de flujos no está habilitado." }, { status: 403 }) } as const;
  return { session } as const;
}

async function flowFor(orgId: string, id: string) {
  return db.query.contractFlows.findFirst({ where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, orgId)), columns: { graphJson: true } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard();
  if ("error" in access) return access.error;
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const nodeId = typeof form?.get("nodeId") === "string" ? String(form.get("nodeId")) : "";
  if (!(file instanceof File) || !nodeId) return NextResponse.json({ error: "Selecciona una plantilla Word y el nodo de generación." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "La plantilla Word debe pesar máximo 20 MB." }, { status: 400 });
  if (file.type !== WORD_MIME && !file.name.toLowerCase().endsWith(".docx")) return NextResponse.json({ error: "Usa un archivo .docx de Microsoft Word." }, { status: 400 });
  const flow = await flowFor(access.session.orgId, id);
  if (!flow) return NextResponse.json({ error: "Flujo no encontrado." }, { status: 404 });
  // A node can have been added in the editor but not persisted yet. The flow
  // ownership check above is the security boundary; the returned template is
  // only attached to the node when the user subsequently saves the flow.

  const storageKey = `contracts/${access.session.orgId}/flows/${id}/word-templates/${randomUUID()}-${file.name.replace(/[^\w.()-]+/g, "-")}`;
  await uploadFile(Buffer.from(await file.arrayBuffer()), storageKey, WORD_MIME);
  const template: WordTemplateConfig = { storageKey, originalName: file.name, mimeType: WORD_MIME, mappings: [] };
  return NextResponse.json({ ok: true, wordTemplate: template }, { status: 201 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard();
  if ("error" in access) return access.error;
  const { id } = await params;
  const nodeId = req.nextUrl.searchParams.get("nodeId") ?? "";
  const flow = await flowFor(access.session.orgId, id);
  if (!flow) return NextResponse.json({ error: "Flujo no encontrado." }, { status: 404 });
  const graph = flowGraphSchema.safeParse(flow.graphJson);
  const node = graph.success ? graph.data.nodes.find((entry) => entry.id === nodeId && entry.kind === "generate") : null;
  const template = node?.kind === "generate" && isWordTemplate(node.data.wordTemplate) ? node.data.wordTemplate : null;
  if (!template) return NextResponse.json({ error: "No hay una plantilla Word guardada para este nodo." }, { status: 404 });
  try {
    const nodeStream = await getFileStream(template.storageKey);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, { headers: { "Content-Type": WORD_MIME, "Content-Disposition": `inline; filename="${template.originalName.replace(/[\r\n"]/g, "")}"`, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "No se pudo leer la plantilla Word guardada." }, { status: 500 });
  }
}
