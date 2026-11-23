import test from "node:test";
import assert from "node:assert/strict";
import { evidenceForFinding, evidenceFromQuotes, findQuotePage, matchQuote, quoteWords, type WordBox } from "../lib/contracts/evidence";
import { runValidations } from "../lib/contracts/validate";

test("palabras comparables sin tildes ni signos", () => {
  assert.deepEqual(quoteWords("DÉCIMA QUINTA. Multas (1 %)"), ["decima", "quinta", "multas", "1"]);
});

test("encuentra la página de la cita, tolerando un error de OCR", () => {
  const pages = [
    { pageNumber: 1, text: "Entre los suscritos, MARCELA GUTIERREZ DIAZ, identificada con cédula" },
    { pageNumber: 2, text: "Representante legal: JORGE ENRIQUE GUTIÉRREZ ROA. Suplente: sin inscripción." },
  ];
  assert.equal(findQuotePage(pages, "Representante legal: Jorge Enrique Gutierrez Roa"), 2);
  assert.equal(findQuotePage(pages, "Representante legaI: Jorge Enrique Gutierrez"), 2, "una letra distinta");
  assert.equal(findQuotePage(pages, "cláusula de multas por retraso"), null);
});

test("recuadro de la cita a partir de palabras con posición", () => {
  const w = (text: string, x1: number, y: number): WordBox => ({ text, x1, x2: x1 + 0.08, y1: y, y2: y + 0.02 });
  const words = [w("DÉCIMA", 0.1, 0.5), w("QUINTA.", 0.2, 0.5), w("MULTAS.", 0.3, 0.5), w("Por", 0.4, 0.5), w("cada", 0.1, 0.53), w("día", 0.2, 0.53)];
  const box = matchQuote(words, "Décima quinta. Multas. Por cada día");
  assert.ok(box);
  assert.equal(box.x1, 0.1);
  assert.equal(box.y1, 0.5);
  assert.ok(Math.abs(box.y2 - 0.55) < 1e-9);
  assert.equal(matchQuote(words, "póliza de cumplimiento vigente"), null);
});

const docs = {
  contrato: [{ documentId: "doc-c", values: { firmantes: ["Marcela Gutiérrez Díaz", "Pedro Ruiz"], valor: "100" }, citations: { firmantes: ["firma MARCELA GUTIERREZ DIAZ", "firma PEDRO RUIZ"], valor: "valor total de cien pesos" } }],
  certificado: [{ documentId: "doc-k", values: { representantes: ["Jorge Enrique Gutiérrez Roa"] }, citations: { representantes: ["Representante legal: JORGE ENRIQUE GUTIÉRREZ ROA"] } }],
};

test("la evidencia de una lista es la cita del elemento del hallazgo", () => {
  const rule = { kind: "cross_reference", subjects: { docType: "contrato", field: "firmantes" }, membership: { docType: "certificado", field: "representantes", label: "Certificado" } };
  const ev = evidenceForFinding(rule, "Marcela Gutiérrez Díaz", docs);
  assert.deepEqual(ev.map((e) => [e.documentId, e.quote]), [["doc-c", "firma MARCELA GUTIERREZ DIAZ"]]);
});

test("los hallazgos llevan evidencia y los aprobados no", () => {
  const results = runValidations([
    { name: "Firmantes con poder", severity: "block", conditionsJson: { kind: "cross_reference", subjects: { docType: "contrato", field: "firmantes" }, membership: { docType: "certificado", field: "representantes", label: "Certificado" } } },
    { name: "Valor mínimo", severity: "warn", conditionsJson: { kind: "numeric_threshold", docType: "contrato", field: "valor", min: 50 } },
  ], docs);
  const fail = results.find((r) => r.subject === "Marcela Gutiérrez Díaz");
  assert.equal(fail?.ok, false);
  assert.equal(fail?.evidence?.[0]?.quote, "firma MARCELA GUTIERREZ DIAZ");
  const ok = results.find((r) => r.ruleName === "Valor mínimo");
  assert.equal(ok?.ok, true);
  assert.equal(ok?.evidence, undefined);
});

test("citas sueltas: sin repetir y como máximo tres", () => {
  assert.deepEqual(evidenceFromQuotes(["a b", "a b", null, "c d", "e f", "g h"]).map((e) => e.quote), ["a b", "c d", "e f"]);
});
