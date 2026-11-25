import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRoute, mapGraphSchema, readAmount, resolveSigners, validateMap, type MapGraph, type SignerContext } from "../lib/approval-map/engine";
import { checkApproval } from "../lib/contracts/approval-rules";

// El mapa del diseño: tipo de contrato → (obra) Jurídica → valor → Gerencia o
// Presidencia; (otro) Analista; al final, si hay algo grave, Dirección jurídica.
const map: MapGraph = mapGraphSchema.parse({
  nodes: [
    { id: "start", type: "start", position: { x: 0, y: 0 } },
    { id: "q-tipo", type: "question", position: { x: 0, y: 0 }, data: { label: "¿Qué tipo de contrato?", subject: { kind: "flow" }, branches: [{ id: "obra", label: "Obra", flowIds: ["flow-obra"] }, { id: "otro", label: "Otro", otherwise: true }] } },
    { id: "s-jur", type: "sign", position: { x: 0, y: 0 }, data: { who: { kind: "role", roleId: "juridica" } } },
    { id: "q-valor", type: "question", position: { x: 0, y: 0 }, data: { label: "", subject: { kind: "field", docType: "contrato", field: "valor", mode: "number" }, branches: [{ id: "bajo", label: "", op: "lte", value: 2_000_000_000 }, { id: "alto", label: "", op: "gt", value: 2_000_000_000 }], missing: "first" } },
    { id: "s-ger", type: "sign", position: { x: 0, y: 0 }, data: { who: { kind: "role", roleId: "gerencia" } } },
    { id: "s-pres", type: "sign", position: { x: 0, y: 0 }, data: { who: { kind: "person", userId: "ricardo" }, comment: true } },
    { id: "s-ana", type: "sign", position: { x: 0, y: 0 }, data: { who: { kind: "role", roleId: "analistas" } } },
    { id: "q-grave", type: "question", position: { x: 0, y: 0 }, data: { label: "¿Encontró algo grave?", subject: { kind: "analysis" }, branches: [{ id: "si", label: "Sí", level: "block" }, { id: "no", label: "No", otherwise: true }] } },
    { id: "s-dir", type: "sign", position: { x: 0, y: 0 }, data: { who: { kind: "role", roleId: "direccion" } } },
    { id: "n-fin", type: "notify", position: { x: 0, y: 0 }, data: { who: { kind: "role", roleId: "gerencia" } } },
    { id: "end", type: "end", position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: "1", source: "start", target: "q-tipo" },
    { id: "2", source: "q-tipo", sourceHandle: "obra", target: "s-jur" },
    { id: "3", source: "q-tipo", sourceHandle: "otro", target: "s-ana" },
    { id: "4", source: "s-jur", target: "q-valor" },
    { id: "5", source: "q-valor", sourceHandle: "bajo", target: "s-ger" },
    { id: "6", source: "q-valor", sourceHandle: "alto", target: "s-pres" },
    { id: "7", source: "s-ger", target: "q-grave" },
    { id: "8", source: "s-pres", target: "q-grave" },
    { id: "9", source: "s-ana", target: "q-grave" },
    { id: "10", source: "q-grave", sourceHandle: "si", target: "s-dir" },
    { id: "11", source: "q-grave", sourceHandle: "no", target: "n-fin" },
    { id: "12", source: "s-dir", target: "n-fin" },
    { id: "13", source: "n-fin", target: "end" },
  ],
});

const contrato = (valor: unknown) => ({ contrato: [{ values: { valor } }] });

test("a case follows the branches its data chooses", () => {
  const obra = evaluateRoute(map, { flowId: "flow-obra", docs: contrato("$1.250.000.000"), verdict: "ok" });
  assert.equal(obra.problem, null);
  assert.deepEqual(obra.steps.map((s) => s.key), ["s-jur", "s-ger", "n-fin"]);
  assert.deepEqual(obra.answers.map((a) => a.answer), ["Obra", "Hasta 2.000 M", "No"]);

  const grande = evaluateRoute(map, { flowId: "flow-obra", docs: contrato("COP 2.500 millones"), verdict: "block" });
  assert.deepEqual(grande.steps.map((s) => s.key), ["s-jur", "s-pres", "s-dir", "n-fin"]);
  assert.equal(grande.steps[1].comment, true);

  const otro = evaluateRoute(map, { flowId: "flow-polizas", docs: {}, verdict: "warn" });
  assert.deepEqual(otro.steps.map((s) => s.key), ["s-ana", "n-fin"]);
});

test("an unreadable amount follows the map's choice", () => {
  const first = evaluateRoute(map, { flowId: "flow-obra", docs: contrato("por definir"), verdict: "ok" });
  assert.deepEqual(first.steps.map((s) => s.key), ["s-jur", "s-ger", "n-fin"]);
  assert.match(first.answers[1].answer, /sin dato/);

  const waiting = mapGraphSchema.parse(JSON.parse(JSON.stringify(map)));
  const q = waiting.nodes.find((n) => n.id === "q-valor")!;
  if (q.type === "question") q.data.missing = "wait";
  const stopped = evaluateRoute(waiting, { flowId: "flow-obra", docs: contrato(null), verdict: "ok" });
  assert.deepEqual(stopped.steps.map((s) => s.kind), ["sign", "wait"]);
  assert.match(stopped.steps[1].reason ?? "", /corrígelo/);
});

test("amounts written with words", () => {
  assert.equal(readAmount("2.500 millones"), 2_500_000_000);
  assert.equal(readAmount("COP 1,5 MM"), 1_500_000);
  assert.equal(readAmount("USD 3 mil"), 3_000);
  assert.equal(readAmount("$ 2 mil millones"), 2_000_000_000);
  assert.equal(readAmount("$58.833.600"), 58_833_600);
  assert.equal(readAmount("sin valor"), null);
});

const people = {
  roles: new Map([
    ["juridica", { name: "Jurídica", memberIds: ["andres", "laura"], substituteId: "patricia" }],
    ["gerencia", { name: "Gerencia", memberIds: ["camilo", "diana"], substituteId: "sofia" }],
    ["analistas", { name: "Analistas", memberIds: ["valeria"], substituteId: null }],
    ["direccion", { name: "Dirección jurídica", memberIds: ["patricia"], substituteId: "marcela" }],
  ]),
  signers: new Set(["andres", "laura", "patricia", "camilo", "diana", "sofia", "valeria", "marcela", "ricardo"]),
};

test("the published map is checked before it is used", () => {
  assert.deepEqual(validateMap(map, people).filter((i) => i.level === "error"), []);
  // Analistas has one person and no substitute: a warning, not an error.
  assert.ok(validateMap(map, people).some((i) => i.level === "warn" && /Analistas/.test(i.message)));

  const broken = mapGraphSchema.parse(JSON.parse(JSON.stringify(map)));
  broken.edges = broken.edges.filter((e) => e.id !== "6");                     // «Más de» leads nowhere
  broken.edges.push({ id: "loop", source: "s-dir", target: "s-jur" });         // and a line goes back
  const messages = validateMap(broken, people).filter((i) => i.level === "error").map((i) => i.message).join(" | ");
  assert.match(messages, /no lleva a ninguna pieza/);
  assert.match(messages, /vuelve hacia atrás/);
  assert.match(messages, /solo puede seguir hacia una pieza/);
});

const ctx = (over: Partial<SignerContext> = {}): SignerContext => ({
  ...people, admins: ["marcela"], creatorId: null, absent: new Set(), alreadySigned: new Set(), escalated: false,
  names: new Map([["camilo", "Camilo Rojas"], ["diana", "Diana Ortiz"], ["sofia", "Sofía Herrera"], ["valeria", "Valeria Torres"], ["ricardo", "Ricardo Valencia"]]),
  ...over,
});

test("who signs: the role, without whoever uploaded, is away or already signed", () => {
  assert.deepEqual(resolveSigners({ kind: "role", roleId: "gerencia" }, ctx()).userIds, ["camilo", "diana"]);
  const uploaded = resolveSigners({ kind: "role", roleId: "gerencia" }, ctx({ creatorId: "camilo" }));
  assert.deepEqual(uploaded.userIds, ["diana"]);
  assert.match(uploaded.note ?? "", /Camilo Rojas subió el caso/);
  // Nobody of the role can: the substitute signs.
  const covered = resolveSigners({ kind: "role", roleId: "gerencia" }, ctx({ creatorId: "camilo", absent: new Set(["diana"]) }));
  assert.deepEqual(covered.userIds, ["sofia"]);
  // No substitute either: an administrator, never the one who uploaded.
  assert.deepEqual(resolveSigners({ kind: "role", roleId: "analistas" }, ctx({ creatorId: "valeria" })).userIds, ["marcela"]);
  assert.deepEqual(resolveSigners({ kind: "person", userId: "ricardo" }, ctx({ absent: new Set(["ricardo"]), creatorId: "marcela" })).userIds, []);
  // Late: the substitute may sign too.
  assert.deepEqual(resolveSigners({ kind: "role", roleId: "gerencia" }, ctx({ escalated: true })).userIds, ["camilo", "diana", "sofia"]);
  // One person never signs two steps.
  assert.deepEqual(resolveSigners({ kind: "role", roleId: "direccion" }, ctx({ alreadySigned: new Set(["patricia"]) })).userIds, ["marcela"]);
});

test("a map's steps are signed in order", () => {
  const steps = [
    { key: "s-jur", label: "Jurídica", approvers: { mode: "users" as const, userIds: ["andres", "laura"] } },
    { key: "s-ger", label: "Gerencia", approvers: { mode: "users" as const, userIds: ["diana"] } },
  ];
  const base = { steps, creatorId: "camilo", noSelfApproval: false, blocked: true, exceptionUserIds: [], ordered: true };
  assert.equal(checkApproval({ ...base, done: [], actor: { id: "diana", canApprove: true } }).ok, false);
  const first = checkApproval({ ...base, done: [], actor: { id: "laura", canApprove: true } });
  assert.ok(first.ok && first.step.key === "s-jur" && !first.last);
  const second = checkApproval({ ...base, done: [{ stepKey: "s-jur", byId: "laura", byEmail: null, at: "", reason: null }], actor: { id: "diana", canApprove: true } });
  assert.ok(second.ok && second.last);
  const waiting = checkApproval({ ...base, steps: [{ ...steps[0], blockedReason: "Falta el valor" }], done: [], actor: { id: "laura", canApprove: true } });
  assert.deepEqual(waiting, { ok: false, reason: "Falta el valor" });
});
