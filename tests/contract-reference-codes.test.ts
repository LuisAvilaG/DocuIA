import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReferenceCode, detectOwnCode, detectReferences, detectDocumentType } from "../lib/contracts/reference-codes";

test("reference codes normalize spacing, separators and N°", () => {
  assert.equal(normalizeReferenceCode("Carta N° 087/2023"), normalizeReferenceCode("CARTA-087-2023"));
  assert.equal(normalizeReferenceCode("ML2-GC-145/2024"), "ML2GC1452024");
});

test("the first heading code is own code and references are distinct", () => {
  const page = "CARTA N° 145-2024\nAsunto: avance de obras.\nEn respuesta a Carta N° 087/2023 y al Informe 018-2023.\nLa Carta 087-2023 trata de lo mismo.";
  const own = detectOwnCode("respuesta.pdf", page);
  assert.equal(normalizeReferenceCode(own ?? ""), "CARTA1452024");
  const refs = detectReferences([{ pageNumber: 1, text: page }], own);
  assert.deepEqual(refs.map((ref) => ref.normalizedCode), ["CARTA0872023", "INFORME0182023"]);
  assert.equal(refs[0].pageNumber, 1);
  assert.match(refs[0].context, /respuesta a Carta/i);
  assert.equal(detectDocumentType("respuesta.pdf", page), "carta");
});

test("dates and clause numbers do not become references", () => {
  const refs = detectReferences([{ pageNumber: 2, text: "Cláusula 8.17 del 12/04/2024. Precio: 150-2024." }], null);
  assert.equal(refs.length, 0);
});
