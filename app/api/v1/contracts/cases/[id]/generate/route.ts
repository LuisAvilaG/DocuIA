import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { uploadFile } from "@/lib/storage/minio";
import { renderTemplate, renderPdf, renderDocPdf, renderHtmlPdf, defaultTemplate, assembleCaseData } from "@/lib/contracts/generate";
import { loadContractPlan } from "@/lib/contracts/plan";
import { logAudit } from "@/lib/audit/log";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  try {
    const [docs, validations, plan] = await Promise.all([
      db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id), columns: { detectedType: true, extractedJson: true } }),
      db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id), columns: { subject: true, status: true, reason: true } }),
      loadContractPlan(session.orgId, kase.flowId),
    ]);

    const data = assembleCaseData(docs, validations);
    const tpl = plan.template;
    const title = tpl?.name ?? kase.title ?? "Documento generado";

    // Prefer the WYSIWYG editor HTML; then the block doc; then the text template.
    let pdf: Uint8Array;
    let missing: string[];
    if (tpl?.html && tpl.html.trim()) {
      const r = await renderHtmlPdf(tpl.html, data, { title });
      pdf = r.bytes; missing = r.missing;
    } else if (tpl?.doc && tpl.doc.blocks.length > 0) {
      const r = await renderDocPdf(tpl.doc, data, { title });
      pdf = r.bytes; missing = r.missing;
    } else {
      const r = tpl?.body ? renderTemplate(tpl.body, data) : { text: defaultTemplate(data), missing: [] as string[] };
      pdf = await renderPdf(r.text, { title });
      missing = r.missing;
    }
    const outputKey = `contracts/${session.orgId}/${id}/output-${Date.now()}.pdf`;
    await uploadFile(Buffer.from(pdf), outputKey, "application/pdf");

    const prevResult = (kase.resultJson ?? {}) as Record<string, unknown>;
    await db.update(contractCases).set({
      status: "generated",
      resultJson: { ...prevResult, outputKey, missing },
      updatedAt: new Date(),
    }).where(eq(contractCases.id, id));

    await logAudit({ orgId: session.orgId, userId: session.sub, action: "contract.generated", resourceType: "contract_case", resourceId: id });

    return NextResponse.json({ ok: true, missing, downloadPath: `/api/v1/contracts/cases/${id}/output` });
  } catch (err) {
    console.error("[contracts/generate]", err);
    return NextResponse.json({ error: "Error al generar el documento" }, { status: 500 });
  }
}
