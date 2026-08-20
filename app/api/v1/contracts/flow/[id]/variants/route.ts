import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { isProductActive } from "@/lib/products";
import { uploadFile } from "@/lib/storage/minio";
import { contractFlows, contractVisualTrainingVariants } from "@/db/schema";
import type { VisualFieldMapping } from "@/lib/contracts/visual-training";

const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function guard(orgId: string) {
  const [product, feature] = await Promise.all([
    isProductActive(orgId, "contract_intelligence"),
    isFeatureEnabled(orgId, "contract_flow_builder"),
  ]);
  return product && feature;
}

function mappingsFrom(value: string | null): VisualFieldMapping[] | null {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed) || parsed.length > 120) return null;
    const valid = parsed.every((item) => {
      if (!item || typeof item !== "object") return false;
      const mapping = item as Record<string, unknown>;
      return typeof mapping.fieldKey === "string" && mapping.fieldKey.length > 0 &&
        Number.isInteger(mapping.page) && Number(mapping.page) > 0 &&
        ["x", "y", "width", "height"].every((key) => typeof mapping[key] === "number" && Number(mapping[key]) >= 0 && Number(mapping[key]) <= 1) &&
        Number(mapping.width) > 0 && Number(mapping.height) > 0 &&
        (mapping.anchorText === undefined || typeof mapping.anchorText === "string");
    });
    return valid ? parsed as VisualFieldMapping[] : null;
  } catch { return null; }
}

async function ownedFlow(id: string, orgId: string) {
  return db.query.contractFlows.findFirst({
    where: and(eq(contractFlows.id, id), eq(contractFlows.organizationId, orgId)),
    columns: { id: true },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "El entrenamiento visual no está habilitado" }, { status: 403 });
  const { id } = await params;
  if (!await ownedFlow(id, session.orgId)) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const variants = await db.query.contractVisualTrainingVariants.findMany({
    where: and(eq(contractVisualTrainingVariants.organizationId, session.orgId), eq(contractVisualTrainingVariants.flowId, id)),
    columns: { id: true, documentType: true, name: true, originalName: true, mimeType: true, signatureText: true, mappingsJson: true, isActive: true, createdAt: true, updatedAt: true },
    orderBy: [desc(contractVisualTrainingVariants.updatedAt)],
  });
  return NextResponse.json({ variants: variants.map((variant) => ({ ...variant, mappings: variant.mappingsJson })) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "El entrenamiento visual no está habilitado" }, { status: 403 });
  const { id: flowId } = await params;
  if (!await ownedFlow(flowId, session.orgId)) return NextResponse.json({ error: "Flujo no encontrado" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const documentType = String(form?.get("documentType") ?? "").trim();
  const name = String(form?.get("name") ?? "").trim();
  const signatureText = String(form?.get("signatureText") ?? "").trim().slice(0, 4000) || null;
  const mappings = mappingsFrom(typeof form?.get("mappings") === "string" ? String(form?.get("mappings")) : null);
  if (!(file instanceof File) || !documentType || !name || !mappings) return NextResponse.json({ error: "Completa el documento, nombre, tipo y campos marcados." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_SAMPLE_BYTES || !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Usa un PDF, JPG, PNG o WEBP de hasta 20 MB." }, { status: 400 });

  const variantId = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "muestra";
  const storageKey = `contracts/${session.orgId}/flow-training/${flowId}/${variantId}-${safeName}`;
  try {
    await uploadFile(Buffer.from(await file.arrayBuffer()), storageKey, file.type);
    await db.insert(contractVisualTrainingVariants).values({
      id: variantId, organizationId: session.orgId, flowId, documentType, name: name.slice(0, 150), storageKey,
      originalName: file.name.slice(0, 255), mimeType: file.type, signatureText, mappingsJson: mappings,
    });
    return NextResponse.json({ ok: true, variant: { id: variantId, documentType, name, originalName: file.name, mimeType: file.type, signatureText, mappings, isActive: true } }, { status: 201 });
  } catch (error) {
    console.error("[contracts/visual-training POST]", error);
    return NextResponse.json({ error: "No se pudo guardar la variante." }, { status: 500 });
  }
}
