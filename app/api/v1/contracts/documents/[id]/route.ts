import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractExtractionLearnings } from "@/db/schema";
import { revalidateContractCase } from "@/lib/contracts/revalidate";
import { isFeatureEnabled } from "@/lib/features";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role === "viewer" || session.role === "api_key") return NextResponse.json({ error: "No tienes permiso para corregir extracciones." }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_ai_extraction")) return NextResponse.json({ error: "La extracción de contratos no está habilitada." }, { status: 403 });

  const body = await request.json().catch(() => null) as { fieldKey?: unknown; value?: unknown; applyToFuture?: unknown } | null;
  const fieldKey = typeof body?.fieldKey === "string" ? body.fieldKey.trim() : "";
  const value = typeof body?.value === "string" ? body.value.trim() : "";
  const applyToFuture = body?.applyToFuture === true;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fieldKey) || !value || value.length > 4000) {
    return NextResponse.json({ error: "Campo o valor inválido." }, { status: 400 });
  }
  if (applyToFuture && session.role !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede aplicar una corrección a futuros documentos." }, { status: 403 });
  }

  const { id } = await params;
  const document = await db.query.contractDocuments.findFirst({ where: eq(contractDocuments.id, id) });
  if (!document) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, document.caseId), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (kase.status === "uploaded" || kase.status === "processing") return NextResponse.json({ error: "Espera a que termine la extracción antes de corregir." }, { status: 409 });

  const values = { ...((document.extractedJson ?? {}) as Record<string, unknown>) };
  if (!(fieldKey in values)) return NextResponse.json({ error: "Este campo no pertenece a la extracción del documento." }, { status: 400 });
  if (Array.isArray(values[fieldKey])) return NextResponse.json({ error: "La corrección de listas estará disponible próximamente." }, { status: 400 });
  const originalValue = values[fieldKey] === null || values[fieldKey] === undefined ? null : String(values[fieldKey]);
  values[fieldKey] = value;

  await db.update(contractDocuments).set({ extractedJson: values }).where(eq(contractDocuments.id, id));
  if (applyToFuture && document.detectedType) {
    const citations = (document.citationsJson ?? {}) as Record<string, unknown>;
    const citation = citations[fieldKey] === null || citations[fieldKey] === undefined ? null : String(citations[fieldKey]);
    await db.insert(contractExtractionLearnings).values({
      organizationId: session.orgId,
      documentType: document.detectedType,
      fieldKey,
      originalValue,
      correctedValue: value,
      citation,
      createdBy: session.sub,
    });
  }

  await revalidateContractCase(kase.id);
  await logAudit({
    orgId: session.orgId,
    userId: session.sub,
    action: applyToFuture ? "contract.extraction_corrected_and_learned" : "contract.extraction_corrected",
    resourceType: "contract_document",
    resourceId: id,
    metadata: { caseId: kase.id, fieldKey, appliedToFuture: applyToFuture },
  });

  return NextResponse.json({ ok: true, extractedJson: values, appliedToFuture: applyToFuture });
}
