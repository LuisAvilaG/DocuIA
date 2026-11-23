import test from "node:test";
import assert from "node:assert/strict";
import { estimateCost, geminiUsage } from "../lib/ai/usage";

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("costo por llamada con caché, lote y tarifa de entradas largas", () => {
  // Sonnet 5.5: $2 entrada, $10 salida, $0.10 caché por millón.
  close(estimateCost("claude-sonnet-5-5", 1_000_000, 100_000), 2 + 1);
  close(estimateCost("claude-sonnet-5-5", 1_000_000, 0, 500_000), 1 + 0.05);
  close(estimateCost("claude-sonnet-5-5", 1_000_000, 100_000, 0, true), 1.5);
  // Haiku 5.5: más de 100 mil tokens de entrada usa la tarifa larga.
  close(estimateCost("claude-haiku-5-5", 50_000, 2_000), (50_000 * 0.10 + 2_000 * 0.50) / 1e6);
  close(estimateCost("claude-haiku-5-5", 200_000, 2_000), (200_000 * 0.50 + 2_000 * 2.50) / 1e6);
  assert.equal(estimateCost("modelo-desconocido", 1000, 1000), null);
  // Totales de muchas llamadas cortas: no se cobra el tramo largo aunque la suma pase de 100 mil.
  close(estimateCost("claude-haiku-5-5", 300_000, 10_000, 0, false, false), (300_000 * 0.10 + 10_000 * 0.50) / 1e6);
});

test("tokens de una respuesta de Gemini", () => {
  assert.deepEqual(geminiUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 5, cachedContentTokenCount: 20 } }),
    { inputTokens: 120, outputTokens: 35, cachedInputTokens: 20 });
  assert.deepEqual(geminiUsage(null), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
});

test("el contexto del proceso llega a llamadas anidadas y no se filtra afuera", async () => {
  const { withAiUsage, currentAiUsage } = await import("../lib/ai/usage");
  const inner = async () => { await new Promise((r) => setTimeout(r, 5)); return currentAiUsage(); };
  const [a, b] = await Promise.all([
    withAiUsage({ orgId: "org-1", source: "contratos" }, inner),
    withAiUsage({ orgId: "org-2", source: "facturas" }, inner),
  ]);
  assert.deepEqual(a, { orgId: "org-1", source: "contratos" });
  assert.deepEqual(b, { orgId: "org-2", source: "facturas" });
  assert.equal(currentAiUsage(), undefined);
});

test("esquemas de respuesta: extracción, análisis y modelo del OCR de gastos", async () => {
  const { extractionSchema } = await import("../lib/contracts/extract");
  const { analysisSchema } = await import("../lib/contracts/ai-analysis");
  const { expenseOcrModel } = await import("../lib/expense/extract");
  const s = extractionSchema([{ fieldKey: "valor_total", label: "Valor", isList: false }, { fieldKey: "firmantes", label: "Firmantes", isList: true }]);
  const values = s.properties!.values;
  assert.deepEqual(values.required, ["valor_total", "firmantes"]);
  assert.equal(values.properties!.firmantes.type, "array");
  assert.equal(values.additionalProperties, false);
  const a = analysisSchema([{ key: "aspecto", label: "Aspecto" }, { key: "cumple", label: "Cumple" }]);
  assert.deepEqual(a.properties!.items.items!.required, ["aspecto", "cumple", "evidence"]);
  assert.deepEqual(a.properties!.outcome.enum, ["pass", "review", "block"]);
  assert.equal(expenseOcrModel("application/pdf"), "claude-haiku-5-5");
  assert.equal(expenseOcrModel("image/jpeg"), "claude-haiku-5-5");
  assert.equal(expenseOcrModel("image/heic"), "gemini-2.5-flash", "formatos de foto que Claude no lee van a Gemini");
});
