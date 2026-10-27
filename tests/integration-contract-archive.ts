// Run only against an isolated local DB + MinIO bucket, never production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { db } from "../lib/db";
import { contractArchiveDocuments, contractArchivePages, contractArchiveReferences, contractCases } from "../db/schema";
import { eq } from "drizzle-orm";
import { CONTRACT_CHUNK_BYTES, createUploadSession, putUploadPart, finishUpload, createCaseFromUploads } from "../lib/contracts/uploads";
import { registerUploadedArchiveDocument, indexArchiveDocument } from "../lib/contracts/archive";

if (!process.env.DATABASE_URL?.includes("docuia_qa_reference") || process.env.MINIO_BUCKET !== "docuia-qa-reference") {
  throw new Error("Esta prueba solo puede ejecutarse en la base y bucket de QA aislados.");
}

const orgId = randomUUID();
const userId = randomUUID();

async function uploadFixture(name: string) {
  const body = await readFile(join(process.cwd(), "demo", "reference-archive", name));
  return uploadBuffer(name, "text/plain", body);
}

async function uploadBuffer(name: string, mimeType: string, body: Uint8Array) {
  const session = await createUploadSession(orgId, userId, name, mimeType, body.length);
  for (let offset = 0, part = 1; offset < body.length; offset += CONTRACT_CHUNK_BYTES, part++) {
    await putUploadPart(session.id, orgId, userId, part, body.subarray(offset, Math.min(body.length, offset + CONTRACT_CHUNK_BYTES)));
  }
  await finishUpload(session.id, orgId, userId);
  return session.id;
}

async function main() {
  const names = ["01-CARTA-001-2026.txt", "02-INFORME-003-2026.txt", "03-CARTA-015-2026.txt"];
  const ids: string[] = [];
  for (const name of names) {
    const uploadId = await uploadFixture(name);
    const id = await registerUploadedArchiveDocument({ organizationId: orgId, createdBy: userId, uploadId });
    await indexArchiveDocument(id);
    ids.push(id);
  }
  const docs = await db.query.contractArchiveDocuments.findMany({ where: eq(contractArchiveDocuments.organizationId, orgId) });
  assert.equal(docs.length, 3);
  assert.ok(docs.every((doc) => doc.status === "ready" && doc.pageCount === 1));
  const latest = docs.find((doc) => doc.originalName === names[2]);
  assert.ok(latest);
  const refs = await db.query.contractArchiveReferences.findMany({ where: eq(contractArchiveReferences.sourceDocumentId, latest.id) });
  assert.equal(refs.length, 3);
  assert.equal(refs.filter((ref) => !!ref.targetDocumentId).length, 2);
  assert.equal(refs.filter((ref) => ref.status === "missing").length, 1);
  const caseUploadId = await uploadFixture(names[2]);
  const caseId = await createCaseFromUploads({ organizationId: orgId, createdBy: userId, title: "QA trazabilidad", uploadIds: [caseUploadId] });
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, caseId) });
  assert.equal(kase?.status, "uploaded");
  if (process.env.PDF_QA === "1") {
    const fixtureMb = Number(process.env.PDF_QA_MB || 21);
    if (!Number.isInteger(fixtureMb) || fixtureMb < 21 || fixtureMb > 149) throw new Error("PDF_QA_MB debe estar entre 21 y 149");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    page.drawText("CARTA-205-2026  Informe de avance de obra", { x: 40, y: 740 });
    pdf.addPage([600, 800]).drawText("Antecedentes generales del proyecto", { x: 40, y: 740 });
    pdf.addPage([600, 800]).drawText("Referencia: INFORME-003-2026. Anexo tecnico final", { x: 40, y: 740 });
    // An incompressible attachment keeps the PDF valid while exercising the
    // 20 MB threshold and the S3 multipart path without a huge page count.
    await pdf.attach(randomBytes(fixtureMb * 1024 * 1024), "qa-payload.bin", { mimeType: "application/octet-stream" });
    const bytes = await pdf.save();
    assert.ok(bytes.length > 20 * 1024 * 1024);
    const pdfUpload = await uploadBuffer("CARTA-205-2026.pdf", "application/pdf", bytes);
    const pdfId = await registerUploadedArchiveDocument({ organizationId: orgId, createdBy: userId, uploadId: pdfUpload });
    await indexArchiveDocument(pdfId);
    const indexed = await db.query.contractArchiveDocuments.findFirst({ where: eq(contractArchiveDocuments.id, pdfId) });
    const pdfPages = await db.query.contractArchivePages.findMany({ where: eq(contractArchivePages.documentId, pdfId) });
    assert.equal(indexed?.pageCount, 3);
    assert.equal(indexed?.status, "ready");
    assert.equal(pdfPages.length, 3);
    assert.ok(pdfPages.some((page) => page.pageNumber === 1 && page.text.includes("CARTA")));
    assert.ok(pdfPages.some((page) => page.pageNumber === 3 && page.text.includes("INFORME-003-2026")));
    console.log(`QA PDF grande OK: ${(bytes.length / 1048576).toFixed(1)} MB, ${Math.ceil(bytes.length / CONTRACT_CHUNK_BYTES)} partes, 3 páginas indexadas (incluida referencia final).`);
  }
  console.log(`QA integración OK: ${ids.length} documentos, ${refs.length} referencias, 1 caso cargado por partes.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
