import test from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { detectOwnCode, detectReferences, normalizeReferenceCode } from "../lib/contracts/reference-codes";
import { fieldInstructions, hasDangerousField, hasWellFormedRuns, validateDocx } from "../lib/security/docx";
import { newestFirst, runValidations, type DocsByType } from "../lib/contracts/validate";
import { requiredSteps } from "../lib/contracts/approval-rules";

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

test("a page of spaces after «CARTA N» is scanned in linear time", () => {
  // Before the fix 5,000 spaces took ~27 s and 10,000 over two minutes.
  const page = `CARTA N${" ".repeat(200_000)}x ${"CARTA N   ".repeat(20_000)}`;
  const { value, ms } = timed(() => detectReferences([{ pageNumber: 1, text: page }], null));
  assert.equal(value.length, 0);
  assert.ok(ms < 1_000, `took ${ms.toFixed(0)} ms`);
  assert.ok(timed(() => detectOwnCode("x".repeat(5_000), page)).ms < 1_000);
});

test("codes split by line breaks and extra spaces are still found", () => {
  const page = "CARTA   N°\n 145 -\t2024\nEn respuesta al Oficio\n\nN.° 87/2023 y al TRANSMITTAL 018 - 23.";
  assert.equal(normalizeReferenceCode(detectOwnCode("r.pdf", page) ?? ""), "CARTA1452024");
  assert.deepEqual(detectReferences([{ pageNumber: 1, text: page }], "CARTA 145-2024").map((ref) => ref.normalizedCode), ["OFICIO872023", "TRANSMITTAL01823"]);
});

test("Word part checks stay linear on unclosed tags", () => {
  for (const xml of ["<".repeat(400_000), "<w:fldChar ".repeat(100_000), "<w:instrText>".repeat(100_000), `<w:fldSimple w:instr="${"x".repeat(10)}`.repeat(50_000)]) {
    const { ms } = timed(() => { hasDangerousField(xml); hasWellFormedRuns(xml); /<[^<>]*altChunk\b/i.test(xml); });
    assert.ok(ms < 1_500, `took ${ms.toFixed(0)} ms on ${xml.slice(0, 20)}`);
  }
});

test("well-formed runs: unclosed or out-of-order tags are rejected", () => {
  assert.equal(hasWellFormedRuns("<w:body><w:p><w:r><w:t xml:space=\"preserve\">a &gt; b</w:t><w:tab/></w:r></w:p><w:p/></w:body>"), true);
  assert.equal(hasWellFormedRuns("<w:tbl><w:tr><w:tc><w:p><w:pPr/><w:t>x</w:t></w:p></w:tc></w:tr></w:tbl>"), true);
  assert.equal(hasWellFormedRuns("<w:p><w:t>sin cerrar</w:p>"), false);
  assert.equal(hasWellFormedRuns("</w:t><w:t>"), false);
  assert.equal(hasWellFormedRuns("<w:p a"), false);
});

test("an encoded «<» does not hide a dangerous field or relationship", async () => {
  const word = (path: string, xml: string) => {
    const zip = new PizZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", "<w:document><w:p><w:t>Hola</w:t></w:p></w:document>");
    zip.file(path, xml);
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  };
  await assert.rejects(validateDocx(word("word/document.xml", '<w:document><w:p><w:r><w:instrText>INCLUDETEXT "http://x" &#60; y</w:instrText></w:r></w:p></w:document>')));
  await assert.rejects(validateDocx(word("word/_rels/document.xml.rels", '<Relationship TargetMode="External" Target="file:///s&#60;x"/>')));
  await assert.rejects(validateDocx(word("word/document.xml", "<w:document><w:p><w:r><w:instrText><![CDATA[INCLUDETEXT x]]></w:instrText></w:r></w:p></w:document>")));
  await assert.rejects(validateDocx(word("word/document.xml", "<w:document><w:p><w:t>sin cerrar</w:document>")), /dañado/);
  assert.deepEqual(fieldInstructions("<w:instrText> PAGE </w:instrText>"), [" PAGE "]);
});

test("the newest document of a type gives the value", () => {
  const old = { id: "a", createdAt: new Date("2026-11-01"), values: { valor: "$100.000.000", firmantes: ["Pedro Ruiz"] } };
  const fixed = { id: "b", createdAt: new Date("2026-11-20"), values: { valor: "$900.000.000", firmantes: ["Ana Gómez"] } };
  assert.deepEqual(newestFirst([old, fixed]).map((doc) => doc.id), ["b", "a"]);
  const docs: DocsByType = { contrato: newestFirst([old, fixed]).map((doc) => ({ values: doc.values, citations: {} })), certificado: [{ values: { representantes: ["Ana Gómez"] }, citations: {} }] };

  const [threshold] = runValidations([{ name: "Valor", conditionsJson: { kind: "numeric_threshold", docType: "contrato", field: "valor", max: 500_000_000 } }], docs);
  assert.equal(threshold.ok, false);
  // Only the corrected contract's signer is checked; the old one no longer fails the case.
  const signers = runValidations([{ name: "Firmantes", conditionsJson: { kind: "cross_reference", subjects: { docType: "contrato", field: "firmantes" }, membership: { docType: "certificado", field: "representantes", label: "En el certificado" } } }], docs);
  assert.deepEqual(signers.map((finding) => [finding.subject, finding.ok]), [["Ana Gómez", true]]);
  // The approval condition reads the corrected amount too.
  const steps = requiredSteps({ base: { mode: "any", userIds: [] }, conditions: [{ label: "Gerencia", docType: "contrato", field: "valor", op: "gt", value: 500_000_000, approvers: { mode: "any", userIds: [] } }], exceptionUserIds: [] } as never, docs);
  assert.deepEqual(steps.map((step) => step.label), ["Siempre", "Gerencia"]);
});
