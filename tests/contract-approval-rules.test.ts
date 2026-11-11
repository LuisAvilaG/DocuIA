import test from "node:test";
import assert from "node:assert/strict";
import { checkApproval, requiredSteps, type ApprovalNodeData } from "../lib/contracts/approval-rules";

const node: ApprovalNodeData = {
  name: "Aprobación",
  base: { mode: "any", userIds: [] },
  conditions: [{ label: "Gerencia si supera $500 M", docType: "contrato", field: "valor_total", op: "gt", value: 500_000_000, approvers: { mode: "users", userIds: ["gerente"] } }],
  exceptionUserIds: [],
};
const docs = (valor: string) => ({ contrato: [{ values: { valor_total: valor } }] });
const base = { creatorId: "creador", noSelfApproval: true, blocked: false, exceptionUserIds: [] as string[] };

test("la condición por valor suma un paso solo si se cumple", () => {
  assert.deepEqual(requiredSteps(node, docs("$120.000.000")).map((s) => s.key), ["base"]);
  assert.deepEqual(requiredSteps(node, docs("$600.000.000")).map((s) => s.key), ["base", "cond_0"]);
  assert.deepEqual(requiredSteps(node, {}).map((s) => s.key), ["base"], "sin dato no se agrega el paso");
});

test("dos aprobaciones: cualquiera firma «Siempre» y la gerencia firma su paso", () => {
  const steps = requiredSteps(node, docs("600000000"));
  const first = checkApproval({ ...base, steps, done: [], actor: { id: "analista", canApprove: true } });
  assert.ok(first.ok && first.step.key === "base" && !first.last);
  const done = [{ stepKey: "base", byId: "analista", byEmail: null, at: "2026-11-11", reason: null }];
  const again = checkApproval({ ...base, steps, done, actor: { id: "analista", canApprove: true } });
  assert.equal(again.ok, false, "la misma persona no firma dos pasos");
  const other = checkApproval({ ...base, steps, done, actor: { id: "otro", canApprove: true } });
  assert.equal(other.ok, false, "el paso de gerencia lo firma la persona asignada");
  const boss = checkApproval({ ...base, steps, done, actor: { id: "gerente", canApprove: true } });
  assert.ok(boss.ok && boss.step.key === "cond_0" && boss.last);
});

test("quien crea no aprueba, y con bloqueos solo la lista de excepción", () => {
  const steps = requiredSteps(node, docs("1"));
  assert.equal(checkApproval({ ...base, steps, done: [], actor: { id: "creador", canApprove: true } }).ok, false);
  assert.equal(checkApproval({ ...base, noSelfApproval: false, steps, done: [], actor: { id: "creador", canApprove: true } }).ok, true);
  assert.equal(checkApproval({ ...base, blocked: true, exceptionUserIds: ["jefa"], steps, done: [], actor: { id: "analista", canApprove: true } }).ok, false);
  assert.equal(checkApproval({ ...base, blocked: true, exceptionUserIds: ["jefa"], steps, done: [], actor: { id: "jefa", canApprove: true } }).ok, true);
});

test("días hábiles entre fechas", async () => {
  const { businessDaysBetween } = await import("../lib/contracts/approval-reminders");
  // Viernes 13 nov 2026 → lunes 16 nov: un día hábil.
  assert.equal(businessDaysBetween(new Date(2026, 10, 13, 10), new Date(2026, 10, 16, 9)), 1);
  assert.equal(businessDaysBetween(new Date(2026, 10, 16, 10), new Date(2026, 10, 16, 18)), 0);
  assert.equal(businessDaysBetween(new Date(2026, 10, 16), new Date(2026, 10, 23)), 5);
});
