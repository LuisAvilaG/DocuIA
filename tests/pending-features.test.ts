import test from "node:test";
import assert from "node:assert/strict";
import { reviewReason } from "../lib/workflow/review-reason";

test("motivo final de revisión: lo más importante primero, como mucho dos", () => {
  const base = { decisionReason: null, vendorSelected: true, lines: [{ selected_item_id: "1" }], confidence: 0.95, threshold: 0.9, neverAutoProcess: false };
  assert.equal(reviewReason({ ...base, lines: [{ selected_item_id: null }, { selected_item_id: null }, { selected_item_id: "1" }] }), "2 líneas sin ítem del ERP");
  assert.equal(reviewReason({ ...base, decisionReason: "No trae orden de compra", vendorSelected: false }), "No trae orden de compra · Proveedor sin identificar en el ERP");
  assert.equal(reviewReason({ ...base, confidence: 0.71 }), "Lectura con 71 % de confianza (pide 90 %)");
  assert.equal(reviewReason({ ...base, neverAutoProcess: true }), "La regla del proveedor pide revisarla siempre");
  assert.equal(reviewReason(base), "Revisión pedida por la configuración");
});

test("aviso cuando el documento de una casilla no parece de ese tipo", async () => {
  const { slotTypeWarning } = await import("../lib/contracts/pipeline");
  const docTypes = [{ key: "poliza", name: "Póliza" }, { key: "contrato", name: "Contrato" }];
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "contrato", docTypes, filled: 5, total: 6 }), "Se subió como Póliza, pero parece Contrato.");
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "poliza", docTypes, filled: 5, total: 6 }), null);
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "unknown", docTypes, filled: 1, total: 8 }), "Se subió como Póliza, pero la IA encontró solo 1 de 8 datos esperados.");
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: null, docTypes, filled: 1, total: 2 }), null, "con pocos campos no se juzga");
});

test("entrega del contratista: tipo real del archivo y token guardado como hash", async () => {
  const { sniffFile, hashToken } = await import("../lib/contracts/upload-links");
  assert.equal(sniffFile(Buffer.from("%PDF-1.7\n...")), "application/pdf");
  assert.equal(sniffFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffFile(Buffer.from("<html>no</html>")), null, "un .pdf falso no pasa");
  assert.match(hashToken("abc"), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken("abc"), "abc");
});

test("posición de la cita en una página escaneada (TSV de tesseract)", async () => {
  const { parseTesseractTsv } = await import("../lib/contracts/ocr-boxes");
  const { matchQuote } = await import("../lib/contracts/evidence");
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t",
    "4\t1\t1\t1\t1\t0\t100\t400\t600\t40\t-1\t",
    "5\t1\t1\t1\t1\t1\t100\t400\t180\t40\t91\tRepresentante",
    "5\t1\t1\t1\t1\t2\t290\t400\t90\t40\t93\tlegal:",
    "5\t1\t1\t1\t1\t3\t390\t400\t120\t40\t88\tJORGE",
    "5\t1\t1\t1\t1\t4\t520\t400\t180\t40\t90\tGUTIÉRREZ",
    "5\t1\t1\t1\t2\t1\t100\t900\t100\t40\t95\tSuplente",
  ].join("\n");
  const words = parseTesseractTsv(tsv);
  assert.equal(words.length, 5);
  assert.deepEqual(words[0], { text: "Representante", x1: 0.1, y1: 0.2, x2: 0.28, y2: 0.22 });
  const box = matchQuote(words, "Representante legal: Jorge Gutierrez");
  assert.ok(box);
  assert.ok(Math.abs(box.x1 - 0.1) < 1e-9 && Math.abs(box.x2 - 0.7) < 1e-9 && Math.abs(box.y1 - 0.2) < 1e-9);
  assert.deepEqual(parseTesseractTsv("sin cabecera"), []);
});

test("un bloqueante sin verificar queda a revisar, no pasa como correcto", async () => {
  const { caseVerdict, findingLevel } = await import("../lib/contracts/validate");
  assert.equal(findingLevel({ ok: null, severity: "block" }), "warn");
  assert.equal(findingLevel({ ok: false, severity: "block" }), "block");
  assert.equal(findingLevel({ ok: null, severity: "warn" }), "warn");
  assert.equal(findingLevel({ ok: false, severity: "info" }), null);
  assert.equal(findingLevel({ ok: true, severity: "block" }), null);
  assert.equal(caseVerdict([{ ok: true, severity: "block" }, { ok: null, severity: "block" }]), "warn");
  assert.equal(caseVerdict([{ ok: null, severity: "block" }, { ok: false, severity: "block" }]), "block");
  assert.equal(caseVerdict([{ ok: true, severity: "warn" }, { ok: null, severity: "info" }]), "ok");
});

test("una cláusula con su texto cuenta como presente; vacía o negada, como ausente", async () => {
  const { clausePresent } = await import("../lib/contracts/validate");
  assert.equal(clausePresent("El contratista indemnizará a la entidad por todo daño."), true);
  assert.equal(clausePresent(true), true);
  assert.equal(clausePresent("sí"), true);
  assert.equal(clausePresent(null), false);
  assert.equal(clausePresent(""), false);
  assert.equal(clausePresent("No"), false);
  assert.equal(clausePresent("No se encontró la cláusula"), false);
  assert.equal(clausePresent(false), false);
});

test("solo el CFDI de ingreso se procesa como factura", async () => {
  const { cfdiNotInvoiceReason } = await import("../lib/workflow/cfdi-parser");
  assert.equal(cfdiNotInvoiceReason("I"), null);
  assert.equal(cfdiNotInvoiceReason(""), null);
  assert.match(cfdiNotInvoiceReason("E") ?? "", /nota de crédito/);
  assert.match(cfdiNotInvoiceReason("p") ?? "", /pago/);
});
