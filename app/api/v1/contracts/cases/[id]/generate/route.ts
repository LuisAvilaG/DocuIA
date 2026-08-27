import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractAiAnalysisResults, contractCases, contractDocuments, contractValidations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getFileBuffer, uploadFile } from "@/lib/storage/minio";
import { renderTemplate, renderPdf, renderDocPdf, renderHtmlPdf, defaultTemplate, assembleCaseData } from "@/lib/contracts/generate";
import { loadContractPlan } from "@/lib/contracts/plan";
import { fillWordTemplate } from "@/lib/contracts/word-template";
import { logAudit } from "@/lib/audit/log";
import { getFeature, isFeatureEnabled } from "@/lib/features";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden generar documentos." }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_document_generation")) {
    return NextResponse.json({ error: "La generación documental no está habilitada para este cliente." }, { status: 403 });
  }

  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const approvalFeature = await getFeature(session.orgId, "contract_approval_workflow");
  const generationAllowed = approvalFeature.isEnabled
    ? kase.status === "approved"
    : kase.status === "validated";
  if (!generationAllowed) {
    return NextResponse.json({ error: approvalFeature.isEnabled
      ? "Primero aprueba el caso para generar el documento."
      : "El caso debe terminar la validación antes de generar el documento." }, { status: 409 });
  }

  try {
    const [docs, validations, analyses, plan] = await Promise.all([
      db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id), columns: { detectedType: true, extractedJson: true } }),
      db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id), columns: { subject: true, status: true, reason: true } }),
      db.query.contractAiAnalysisResults.findMany({ where: eq(contractAiAnalysisResults.caseId, id), columns: { ruleName: true, summary: true, itemsJson: true } }),
      loadContractPlan(session.orgId, kase.flowId),
    ]);

    const data = assembleCaseData(docs, validations, analyses);
    const tpl = plan.template;
    const title = tpl?.name ?? kase.title ?? "Documento generado";

    // A tenant-provided Word template stays a DOCX so its corporate layout,
    // headers, footers and editable tables survive intact. Editor templates
    // keep their existing PDF path.
    let output: Uint8Array;
    let missing: string[];
    let outputMime = "application/pdf";
    let outputName = `${title}.pdf`;
    if (tpl?.source === "word" && tpl.wordTemplate) {
      output = fillWordTemplate(await getFileBuffer(tpl.wordTemplate.storageKey), tpl.wordTemplate, data);
      missing = tpl.wordTemplate.mappings.filter((mapping) => data[mapping.fieldKey] === undefined || data[mapping.fieldKey] === null || data[mapping.fieldKey] === "").map((mapping) => mapping.fieldKey);
      outputMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      outputName = `${title}.docx`;
    } else if (tpl?.html && tpl.html.trim()) {
      const r = await renderHtmlPdf(tpl.html, data, { title });
      output = r.bytes; missing = r.missing;
    } else if (tpl?.doc && tpl.doc.blocks.length > 0) {
      const r = await renderDocPdf(tpl.doc, data, { title });
      output = r.bytes; missing = r.missing;
    } else {
      const r = tpl?.body ? renderTemplate(tpl.body, data) : { text: defaultTemplate(data), missing: [] as string[] };
      output = await renderPdf(r.text, { title });
      missing = r.missing;
    }
    const extension = outputMime === "application/pdf" ? "pdf" : "docx";
    const outputKey = `contracts/${session.orgId}/${id}/output-${Date.now()}.${extension}`;
    await uploadFile(Buffer.from(output), outputKey, outputMime);

    const prevResult = (kase.resultJson ?? {}) as Record<string, unknown>;
    await db.update(contractCases).set({
      // The approval remains the source of truth. Generation is an output of
      // that decision, not a replacement for it in the case lifecycle.
      status: kase.status,
      resultJson: { ...prevResult, outputKey, outputMime, outputName, missing, generatedAt: new Date().toISOString() },
      updatedAt: new Date(),
    }).where(eq(contractCases.id, id));

    await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.generated", resourceType: "contract_case", resourceId: id });

    return NextResponse.json({ ok: true, missing, outputMime, downloadPath: `/api/v1/contracts/cases/${id}/output` });
  } catch (err) {
    console.error("[contracts/generate]", err);
    return NextResponse.json({ error: "Error al generar el documento" }, { status: 500 });
  }
}
