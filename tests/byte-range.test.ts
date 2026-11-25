import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../lib/storage/byte-range";

test("un tramo dentro del archivo se devuelve tal cual", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=500-999", 1000), { start: 500, end: 999 });
});

test("un tramo abierto o que se pasa del final termina en el último byte", () => {
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
});

test("sin tramo utilizable se responde con el archivo completo", () => {
  assert.equal(parseByteRange(null, 1000), null);
  assert.equal(parseByteRange("", 1000), null);
  assert.equal(parseByteRange("bytes=-500", 1000), null);
  assert.equal(parseByteRange("bytes=0-10,20-30", 1000), null);
  assert.equal(parseByteRange("bytes=50-10", 1000), null);
  assert.equal(parseByteRange("items=0-10", 1000), null);
});

test("un tramo que empieza después del final no se puede servir", () => {
  assert.equal(parseByteRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=1000-1200", 1000), "unsatisfiable");
});

test("un archivo vacío se responde completo", () => {
  assert.equal(parseByteRange("bytes=0-", 0), null);
});
