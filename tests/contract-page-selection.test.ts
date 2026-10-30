import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldBatches, locatePages, parseToc, printedPageOffset, selectPagesForFields, widenPages, withinOneEdit } from "../lib/contracts/page-selection";

const filler = (n: number) => `Página administrativa ${n}. Texto de relleno sobre procedimientos internos y comunicaciones entre las partes.`;

test("large PDF retrieval includes relevant late pages and page labels", () => {
  const pages = Array.from({ length: 100 }, (_, i) => ({ pageNumber: i + 1, text: i === 89 ? "La garantía de cumplimiento y su vigencia es de dos años." : filler(i + 1) }));
  const selected = selectPagesForFields(pages, [{ fieldKey: "vigencia_garantia", label: "Vigencia de garantía de cumplimiento", isList: false }], 3000);
  assert.match(selected, /\[Página 90\]/);
  assert.match(selected, /\[Página 1\]/);
  assert.ok(selected.length <= 3000);
});

test("fields are divided into bounded extraction batches", () => {
  assert.deepEqual(fieldBatches(Array.from({ length: 15 }, (_, i) => i)), [Array.from({ length: 7 }, (_, i) => i), Array.from({ length: 7 }, (_, i) => i + 7), [14]]);
});

test("cover and closing pages are always part of the selection", () => {
  const pages = Array.from({ length: 60 }, (_, i) => ({ pageNumber: i + 1, text: filler(i + 1) }));
  const located = locatePages(pages, [{ fieldKey: "objeto", label: "Objeto del contrato", isList: false }], { maxPages: 8 });
  for (const page of [1, 2, 59, 60]) assert.ok(located.pages.includes(page), `page ${page}`);
  assert.deepEqual(located.reasons[1], ["portada"]);
  assert.deepEqual(located.reasons[60], ["cierre"]);
});

test("a clause is found through its usual words even when the label words are absent", () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({
    pageNumber: i + 1,
    text: i === 21
      ? "QUINTA: DURACIÓN - El presente contrato será a partir del 17 de febrero hasta el 16 de abril, para un total de dos (2) meses, prorrogables."
      : filler(i + 1),
  }));
  const located = locatePages(pages, [{ fieldKey: "plazo_ejecucion", label: "Plazo de ejecución", isList: false }], { maxPages: 8 });
  assert.equal(located.byField.plazo_ejecucion[0], 22);
  assert.ok(located.pages.includes(22));
});

test("one-character OCR noise still matches the field words", () => {
  assert.ok(withinOneEdit("cumplimiento", "cumplimienlo"));
  assert.ok(withinOneEdit("garantia", "garanlia"));
  assert.ok(!withinOneEdit("garantia", "garanlla"));
  const pages = Array.from({ length: 30 }, (_, i) => ({
    pageNumber: i + 1,
    text: i === 14 ? "SEXTA: PÓLIZAS. Garanlia de Fiel Cumplimienlo del Conlrato por el veinte por ciento (20%) del valor." : filler(i + 1),
  }));
  const located = locatePages(pages, [{ fieldKey: "garantia_cumplimiento", label: "Garantía de fiel cumplimiento del contrato", isList: false }], { maxPages: 8 });
  assert.equal(located.byField.garantia_cumplimiento[0], 15);
});

test("the document's own index points at the page, even when OCR splits an entry over two lines", () => {
  const indexText = [
    "ÍNDICE",
    "SECCIÓN I: ANTECEDENTES ........ 6",
    "Definiciones ........ 8",
    "Base Legal ........ 12",
    "SECCIÓN II: OBJETO ........ 14",
    "Plazo de la Concesión .. . . .... .",
    ".. . . ..44",
    "Prórroga del Plazo ........ 44",
    "Régimen de Bienes ........ 45",
  ].join("\n");
  const pages = Array.from({ length: 80 }, (_, i) => ({
    pageNumber: i + 1,
    text: i === 1 ? indexText : i === 44 ? "SECCIÓN IV\nPlazo de la Concesión\n4.1 La Concesión se otorga por un plazo de treinta y cinco (35) años.\n[44]" : `${filler(i + 1)}\n[${i}]`,
  }));
  const toc = parseToc(pages);
  assert.ok(toc.some((entry) => /Plazo de la Concesi/.test(entry.title) && entry.docPage === 44));
  assert.equal(printedPageOffset(pages), 1);
  const located = locatePages(pages, [{ fieldKey: "plazo_concesion", label: "Plazo de la concesión", isList: false }], { maxPages: 8 });
  assert.equal(located.byField.plazo_concesion[0], 45);
  assert.ok(located.reasons[45].some((reason) => reason.includes("índice")));
});

test("widening skips pages already sent and walks each field's candidates", () => {
  const located = { pages: [1, 10, 20], byField: { a: [10, 11, 12], b: [20, 21] }, reasons: {} };
  assert.deepEqual(widenPages(located, ["a", "b"], [1, 10, 20], 3), [11, 12, 21]);
  assert.deepEqual(widenPages(located, ["b"], [20, 21], 3), []);
});

test("every field gets its best page before any field gets its second", () => {
  const pages = Array.from({ length: 50 }, (_, i) => ({
    pageNumber: i + 1,
    text: i === 9 ? "Valor del contrato: la suma de cincuenta millones de pesos incluido IVA, precio total, monto, importe, cuantía, honorarios."
      : i === 10 ? "Valor del contrato, valor, precio, monto, suma, importe, pesos, honorarios, cuantía, total."
      : i === 29 ? "Arbitraje: toda controversia será resuelta por un tribunal arbitral de la Cámara de Comercio."
      : filler(i + 1),
  }));
  const located = locatePages(pages, [
    { fieldKey: "valor", label: "Valor del contrato", isList: false },
    { fieldKey: "arbitraje", label: "Arbitraje", isList: false },
  ], { maxPages: 7 });
  assert.ok(located.pages.includes(30), "the weaker field still lands its page");
});
