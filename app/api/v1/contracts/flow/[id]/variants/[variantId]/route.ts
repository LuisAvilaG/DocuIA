import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { isProductActive } from "@/lib/products";
import { deleteFile } from "@/lib/storage/minio";
import { contractVisualTrainingVariants } from "@/db/schema";
import type { VisualFieldMapping } from "@/lib/contracts/visual-training";

async function guard(orgId: string) {
  const [product, feature] = await Promise.all([isProductActive(orgId, "contract_intelligence"), isFeatureEnabled(orgId, "contract_flow_builder")]);
  return product && feature;
}
function validMappings(value: unknown): value is VisualFieldMapping[] {
  return Array.isArray(value) && value.length <= 120 && value.every((m) => m && typeof m === "object" && typeof m.fieldKey === "string" && Number.isInteger(m.page) && [m.x, m.y, m.width, m.height].every((v) => typeof v === "number" && v >= 0 && v <= 1) && m.width > 0 && m.height > 0 && (m.anchorText === undefined || typeof m.anchorText === "string"));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "El entrenamiento visual no está habilitado" }, { status: 403 });
  const { id: flowId, variantId } = await params;
  const body = await req.json().catch(() => null) as { name?: unknown; mappings?: unknown; signatureText?: unknown; isActive?: unknown } | null;
  if (!body || (body.mappings !== undefined && !validMappings(body.mappings)) || (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) || (body.signatureText !== undefined && typeof body.signatureText !== "string") || (body.isActive !== undefined && typeof body.isActive !== "boolean")) return NextResponse.json({ error: "Datos de variante inválidos." }, { status: 400 });
  const changed = await db.update(contractVisualTrainingVariants).set({
    ...(typeof body.name === "string" ? { name: body.name.trim().slice(0, 150) } : {}),
    ...(body.mappings ? { mappingsJson: body.mappings } : {}),
    ...(typeof body.signatureText === "string" ? { signatureText: body.signatureText.trim().slice(0, 4000) || null } : {}),
    ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}), updatedAt: new Date(),
  }).where(and(eq(contractVisualTrainingVariants.id, variantId), eq(contractVisualTrainingVariants.flowId, flowId), eq(contractVisualTrainingVariants.organizationId, session.orgId))).returning({ id: contractVisualTrainingVariants.id });
  if (!changed.length) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "El entrenamiento visual no está habilitado" }, { status: 403 });
  const { id: flowId, variantId } = await params;
  const row = await db.query.contractVisualTrainingVariants.findFirst({ where: and(eq(contractVisualTrainingVariants.id, variantId), eq(contractVisualTrainingVariants.flowId, flowId), eq(contractVisualTrainingVariants.organizationId, session.orgId)), columns: { storageKey: true } });
  if (!row) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  await db.delete(contractVisualTrainingVariants).where(eq(contractVisualTrainingVariants.id, variantId));
  void deleteFile(row.storageKey).catch((error) => console.error("[contracts/visual-training DELETE]", error));
  return NextResponse.json({ ok: true });
}
