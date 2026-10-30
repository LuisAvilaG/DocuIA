import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_MODELS, parseJsonObject, providerOf } from "../lib/ai/provider";

test("model ids route to their provider", () => {
  assert.equal(providerOf("gemini-2.5-flash"), "gemini");
  assert.equal(providerOf("claude-haiku-5-5"), "anthropic");
  for (const model of AI_MODELS) assert.equal(providerOf(model.id), model.provider);
});

test("JSON is read whether it comes bare, fenced or wrapped in prose", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Aquí está el resultado: {"a":{"b":[1,2]}} gracias'), { a: { b: [1, 2] } });
  assert.deepEqual(parseJsonObject(""), {});
  assert.throws(() => parseJsonObject("sin objeto"));
});
