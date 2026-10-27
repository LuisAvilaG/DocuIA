import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldBatches, selectPagesForFields } from "../lib/contracts/page-selection";

test("large PDF retrieval includes relevant late pages and page labels", () => {
  const pages = Array.from({ length: 100 }, (_, i) => ({ pageNumber: i + 1, text: i === 89 ? "La garantía de cumplimiento y su vigencia es de dos años." : `Página administrativa ${i + 1}.` }));
  const selected = selectPagesForFields(pages, [{ fieldKey: "vigencia_garantia", label: "Vigencia de garantía de cumplimiento", isList: false }], 3000);
  assert.match(selected, /\[Página 90\]/);
  assert.match(selected, /\[Página 1\]/);
  assert.ok(selected.length <= 3000);
});

test("fields are divided into bounded extraction batches", () => {
  assert.deepEqual(fieldBatches(Array.from({ length: 15 }, (_, i) => i)), [Array.from({ length: 7 }, (_, i) => i), Array.from({ length: 7 }, (_, i) => i + 7), [14]]);
});
