import test from "node:test";
import assert from "node:assert/strict";
import { parseLocaleNumber } from "../lib/numbers";

const CASES: Array<[unknown, number | null]> = [
  ["$1.500.000,00", 1500000],
  ["1.500.000", 1500000],
  ["4.603.482.380", 4603482380],
  ["4,603,482,380", 4603482380],
  ["1,234.56", 1234.56],
  ["1.234,56", 1234.56],
  ["150.000", 150000],
  ["21.008", 21008],
  ["12,5", 12.5],
  ["12.50", 12.5],
  ["0,125", 0.125],
  [".5", 0.5],
  ["COP 2.500", 2500],
  ["-1.200,50", -1200.5],
  ["$ -450", -450],
  ["NIT 900-123", 900123],
  [0.125, 0.125],
  [1234.5, 1234.5],
  ["", null],
  ["sin valor", null],
  [null, null],
  [Number.NaN, null],
];

test("amounts parse regardless of the separator convention", () => {
  for (const [input, expected] of CASES) {
    assert.equal(parseLocaleNumber(input), expected, `parseLocaleNumber(${JSON.stringify(input)})`);
  }
});
