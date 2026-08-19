import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractExtractionLearnings, contractValidations } from "@/db/schema";
import { calculateContractRevalidation } from "@/lib/contracts/revalidate";
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
  const recalculation = await calculateContractRevalidation(kase.id, { [id]: values });

  // The document, optional tenant learning and refreshed verdict are one unit:
  // a migration/write failure must not leave a corrected field with stale rules.
  try {
    await db.transaction(async (tx) => {
      await tx.update(contractDocuments).set({ extractedJson: values }).where(eq(contractDocuments.id, id));
      if (applyToFuture && document.detectedType) {
        const citations = (document.citationsJson ?? {}) as Record<string, unknown>;
        const citation = citations[fieldKey] === null || citations[fieldKey] === undefined ? null : String(citations[fieldKey]);
        await tx.insert(contractExtractionLearnings).values({
          organizationId: session.orgId,
          documentType: document.detectedType,
          fieldKey,
          originalValue,
          correctedValue: value,
          citation,
          createdBy: session.sub,
        });
      }
      await tx.delete(contractValidations).where(eq(contractValidations.caseId, kase.id));
      if (recalculation.validations.length > 0) {
        await tx.insert(contractValidations).values(recalculation.validations.map((validation) => ({
          caseId: kase.id,
          ruleName: validation.ruleName,
          severity: validation.severity,
          subject: validation.subject,
          status: validation.status,
          ok: validation.ok,
          reason: validation.reason,
          checksJson: validation.checks,
          citation: validation.citation,
        })));
      }
      await tx.update(contractCases).set({ status: "validated", resultJson: recalculation.resultJson, updatedAt: new Date() }).where(eq(contractCases.id, kase.id));
    });
  } catch {
    return NextResponse.json({
      error: applyToFuture
        ? "No se guardó la corrección ni el aprendizaje. Confirma que la actualización de base de datos haya terminado."
        : "No se pudo guardar la corrección. No se aplicó ningún cambio.",
    }, { status: 500 });
  }
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
