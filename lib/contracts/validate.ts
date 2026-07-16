import { normalizeForLookup } from "@/lib/workflow/similarity";

// ── Declarative validation engine ─────────────────────────────────────
// Rules are configured per flow (validate nodes). Each rule is ONE condition
// of a given `kind`, carries a `severity` (semáforo) and a human `name` (label).
// The engine runs deterministically over the fields extracted from each document.

export type Severity = "info" | "warn" | "block";

export interface DocData { values: Record<string, unknown>; citations: Record<string, unknown> }
export type DocsByType = Record<string, DocData[]>;

export interface ValidationResult {
  ruleName: string;
  severity: Severity;
  subject:  string;              // what was checked
  ok:       boolean | null;      // pass / fail / unknown
  status:   string;              // human outcome label
  reason:   string;
  checks:   Array<{ label: string; ok: boolean | null }>;
  citation: string | null;
}

interface Ref { docType: string; field: string }

// ── Helpers ───────────────────────────────────────────────────────────
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (v === null || v === undefined || v === "") return [];
  return [String(v)];
}
function firstValue(docsByType: DocsByType, ref: Ref): unknown {
  const d = (docsByType[ref.docType] ?? [])[0];
  return d ? d.values[ref.field] : undefined;
}
function tokens(s: string): string[] { return normalizeForLookup(s).split(" ").filter((t) => t.length >= 2); }

// Tolerant name match: order-insensitive, ignores missing second names, OCR noise.
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeForLookup(a), nb = normalizeForLookup(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  const hits = short.filter((t) => longSet.has(t)).length;
  return hits / short.length >= 0.6 && hits >= 2;
}
function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "1", "si", "sí", "yes", "revocado", "presente", "incluye", "x"].includes(s);
}
function toNumber(v: unknown): number | null {
  const s = String(v ?? "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function toDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── LATAM tax-ID validation (region-agnostic; country picks the algorithm) ──
function mod11Weighted(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i];
  return sum % 11;
}
export function validateTaxId(raw: string, country?: string): boolean {
  const v = String(raw ?? "").trim();
  if (!v) return false;
  const digits = v.replace(/[.\-/\s]/g, "");
  switch ((country ?? "").toUpperCase()) {
    case "CL": { // RUT — mod 11, check digit 0-9 or K
      const body = digits.slice(0, -1), dv = digits.slice(-1).toUpperCase();
      if (!/^\d+$/.test(body)) return false;
      let sum = 0, mul = 2;
      for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
      const r = 11 - (sum % 11);
      const exp = r === 11 ? "0" : r === 10 ? "K" : String(r);
      return exp === dv;
    }
    case "AR": { // CUIT/CUIL — 11 digits, mod 11
      if (!/^\d{11}$/.test(digits)) return false;
      const r = 11 - mod11Weighted(digits, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]);
      const dv = r === 11 ? 0 : r === 10 ? 9 : r;
      return dv === Number(digits[10]);
    }
    case "CO": { // NIT — mod 11
      if (!/^\d{6,16}$/.test(digits)) return false;
      const body = digits.slice(0, -1), dv = Number(digits.slice(-1));
      const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
      let sum = 0;
      for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * w[i];
      const r = sum % 11;
      return (r > 1 ? 11 - r : r) === dv;
    }
    case "BR": {
      if (/^(\d)\1+$/.test(digits)) return false; // all-same-digit is invalid by convention
      if (/^\d{11}$/.test(digits)) { // CPF
        const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(digits[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
        return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
      }
      if (/^\d{14}$/.test(digits)) { // CNPJ
        const calc = (len: number) => { const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < len; i++) s += Number(digits[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
        return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
      }
      return false;
    }
    case "MX": return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(digits); // RFC
    case "PE": return /^\d{11}$/.test(digits);                        // RUC
    case "EC": return /^\d{13}$/.test(digits);                        // RUC
    case "PY": return /^\d{6,9}-?\d$/.test(v);                        // RUC PY
    default:   return /^[A-Z0-9.\-/]{5,20}$/i.test(v);               // generic sanity
  }
}

// ── Rule kinds ────────────────────────────────────────────────────────
export type ValidationRule =
  | { kind: "cross_reference"; subjects: Ref; membership: Ref & { label: string }; confirmation?: Ref & { label: string; revokedWhenTruthy?: boolean }; statusLabels?: { pass: string; fail: string; unknown: string } }
  | { kind: "field_match"; left: Ref; right: Ref; mode?: "equal" | "different"; numericTolerance?: number }
  | { kind: "clause_presence"; docType: string; field: string; mustExist?: boolean }
  | { kind: "numeric_threshold"; docType: string; field: string; min?: number; max?: number }
  | { kind: "date_rule"; docType: string; field: string; notExpired?: boolean; before?: Ref }
  | { kind: "field_format"; docType: string; field: string; format: "tax_id" | "email" | "date" | "number" | "nonempty"; country?: string }
  | { kind: "document_required"; docTypes: string[] }
  | { kind: "signatures_complete"; subjects: Ref; signatures: Ref };

type Finding = Omit<ValidationResult, "ruleName" | "severity">;
const pass = (subject: string, status: string, reason: string, checks: Finding["checks"] = [], citation: string | null = null): Finding => ({ subject, ok: true, status, reason, checks, citation });
const fail = (subject: string, status: string, reason: string, checks: Finding["checks"] = [], citation: string | null = null): Finding => ({ subject, ok: false, status, reason, checks, citation });
const unk  = (subject: string, status: string, reason: string, checks: Finding["checks"] = [], citation: string | null = null): Finding => ({ subject, ok: null, status, reason, checks, citation });

// Every doc/field reference a rule points at (used to validate the graph).
export function ruleRefs(rule: ValidationRule): Ref[] {
  switch (rule.kind) {
    case "cross_reference":     return [rule.subjects, rule.membership, ...(rule.confirmation ? [rule.confirmation] : [])];
    case "field_match":         return [rule.left, rule.right];
    case "clause_presence":     return [{ docType: rule.docType, field: rule.field }];
    case "numeric_threshold":   return [{ docType: rule.docType, field: rule.field }];
    case "date_rule":           return [{ docType: rule.docType, field: rule.field }, ...(rule.before ? [rule.before] : [])];
    case "field_format":        return [{ docType: rule.docType, field: rule.field }];
    case "document_required":   return [];
    case "signatures_complete": return [rule.subjects, rule.signatures];
  }
}

// ── Per-kind execution ────────────────────────────────────────────────
function runCrossReference(r: Extract<ValidationRule, { kind: "cross_reference" }>, docs: DocsByType): Finding[] {
  const labels = r.statusLabels ?? { pass: "válido", fail: "no válido", unknown: "indeterminado" };
  const subjects = (docs[r.subjects.docType] ?? []).flatMap((d) => asList(d.values[r.subjects.field]));
  const members = (docs[r.membership.docType] ?? []).flatMap((d) => asList(d.values[r.membership.field]));
  const confDocs = r.confirmation ? (docs[r.confirmation.docType] ?? []) : [];
  const noun = r.membership.label.toLowerCase().replace(/^en\s+/, "");
  if (subjects.length === 0) return [unk("—", labels.unknown, "No hay elementos para validar.")];
  return subjects.map((s) => {
    const inMembers = members.some((m) => namesMatch(s, m));
    const checks: Finding["checks"] = [{ label: r.membership.label, ok: inMembers }];
    if (!inMembers) return fail(s, labels.fail, `No aparece en ${noun}.`, checks);
    if (r.confirmation) {
      if (confDocs.length === 0) { checks.push({ label: r.confirmation.label, ok: null }); return unk(s, labels.unknown, `Aparece en ${noun} pero no hay ${r.confirmation.label.toLowerCase()} que lo confirme.`, checks); }
      const revoked = confDocs.some((d) => r.confirmation!.revokedWhenTruthy !== false && truthy(d.values[r.confirmation!.field]));
      checks.push({ label: r.confirmation.label, ok: !revoked });
      return revoked ? fail(s, labels.fail, `El ${r.confirmation.label.toLowerCase()} indica revocación.`, checks) : pass(s, labels.pass, "Confirmado.", checks);
    }
    return pass(s, labels.pass, "Validado.", checks);
  });
}

function runFieldMatch(r: Extract<ValidationRule, { kind: "field_match" }>, docs: DocsByType): Finding[] {
  const a = firstValue(docs, r.left), b = firstValue(docs, r.right);
  const subject = `${r.left.field} vs ${r.right.field}`;
  if (a === undefined || b === undefined) return [unk(subject, "faltante", "Falta uno de los campos a comparar.")];
  const na = toNumber(a), nb = toNumber(b);
  const equal = (na !== null && nb !== null) ? Math.abs(na - nb) <= (r.numericTolerance ?? 0) : namesMatch(String(a), String(b));
  const wantEqual = (r.mode ?? "equal") === "equal";
  return [(wantEqual ? equal : !equal)
    ? pass(subject, wantEqual ? "coinciden" : "difieren", `"${a}" y "${b}" ${wantEqual ? "coinciden" : "difieren"} como se esperaba.`)
    : fail(subject, wantEqual ? "no coinciden" : "coinciden", `"${a}" y "${b}" ${wantEqual ? "no coinciden" : "coinciden cuando deberían diferir"}.`)];
}

function runClause(r: Extract<ValidationRule, { kind: "clause_presence" }>, docs: DocsByType): Finding[] {
  const present = truthy(firstValue(docs, { docType: r.docType, field: r.field }));
  const mustExist = r.mustExist !== false;
  return [(mustExist ? present : !present)
    ? pass(r.field, present ? "presente" : "ausente", mustExist ? "La cláusula requerida está presente." : "La cláusula prohibida no aparece.")
    : fail(r.field, present ? "presente" : "ausente", mustExist ? "Falta la cláusula requerida." : "Aparece una cláusula que no debería estar.")];
}

function runThreshold(r: Extract<ValidationRule, { kind: "numeric_threshold" }>, docs: DocsByType): Finding[] {
  const n = toNumber(firstValue(docs, { docType: r.docType, field: r.field }));
  if (n === null) return [unk(r.field, "sin valor", "No se pudo leer un número.")];
  const okMin = r.min === undefined || n >= r.min;
  const okMax = r.max === undefined || n <= r.max;
  const parts: string[] = [];
  if (r.min !== undefined) parts.push(`min ${r.min}`);
  if (r.max !== undefined) parts.push(`max ${r.max}`);
  const range = parts.join(", ") || "sin límites";
  return [okMin && okMax ? pass(r.field, "en rango", `${n} está dentro de rango (${range}).`) : fail(r.field, "fuera de rango", `${n} está fuera de rango (${range}).`)];
}

function runDate(r: Extract<ValidationRule, { kind: "date_rule" }>, docs: DocsByType, now: Date): Finding[] {
  const d = toDate(firstValue(docs, { docType: r.docType, field: r.field }));
  if (!d) return [unk(r.field, "sin fecha", "No se pudo leer una fecha.")];
  const checks: Finding["checks"] = [];
  if (r.notExpired) {
    const ok = d.getTime() >= now.getTime();
    checks.push({ label: "No vencida", ok });
    if (!ok) return [fail(r.field, "vencida", `La fecha ${d.toLocaleDateString("es-MX")} ya venció.`, checks)];
  }
  if (r.before) {
    const other = toDate(firstValue(docs, r.before));
    const ok = other ? d.getTime() < other.getTime() : null;
    checks.push({ label: `Antes de ${r.before.field}`, ok });
    if (ok === false) return [fail(r.field, "orden inválido", `${r.field} no es anterior a ${r.before.field}.`, checks)];
  }
  return [pass(r.field, "válida", "La fecha cumple las condiciones.", checks)];
}

const FORMAT_RE: Record<string, RegExp> = { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, number: /^-?[\d.,]+$/ };
function runFormat(r: Extract<ValidationRule, { kind: "field_format" }>, docs: DocsByType): Finding[] {
  const s = String(firstValue(docs, { docType: r.docType, field: r.field }) ?? "").trim();
  if (r.format === "nonempty") return [s ? pass(r.field, "presente", "Campo presente.") : fail(r.field, "vacío", "El campo obligatorio está vacío.")];
  if (!s) return [fail(r.field, "vacío", "El campo está vacío.")];
  let okr: boolean;
  if (r.format === "tax_id") okr = validateTaxId(s, r.country);
  else if (r.format === "date") okr = toDate(s) !== null;
  else okr = FORMAT_RE[r.format].test(s);
  const label = r.format === "tax_id" ? `ID fiscal${r.country ? ` (${r.country})` : ""}` : r.format;
  return [okr ? pass(r.field, "formato válido", `"${s}" es un ${label} válido.`) : fail(r.field, "formato inválido", `"${s}" no es un ${label} válido.`)];
}

function runDocRequired(r: Extract<ValidationRule, { kind: "document_required" }>, docs: DocsByType): Finding[] {
  const missing = r.docTypes.filter((t) => (docs[t] ?? []).length === 0);
  return [missing.length === 0 ? pass("documentos", "completo", "Están todos los documentos requeridos.") : fail("documentos", "faltantes", `Faltan documentos: ${missing.join(", ")}.`)];
}

function runSignatures(r: Extract<ValidationRule, { kind: "signatures_complete" }>, docs: DocsByType): Finding[] {
  const expected = (docs[r.subjects.docType] ?? []).flatMap((d) => asList(d.values[r.subjects.field]));
  const signed = (docs[r.signatures.docType] ?? []).flatMap((d) => asList(d.values[r.signatures.field]));
  if (expected.length === 0) return [unk("firmas", "sin partes", "No hay partes esperadas para verificar firmas.")];
  const missing = expected.filter((e) => !signed.some((s) => namesMatch(e, s)));
  return [missing.length === 0 ? pass("firmas", "completas", "Todas las partes esperadas firmaron.") : fail("firmas", "incompletas", `Falta la firma de: ${missing.join(", ")}.`)];
}

// ── Dispatch ──────────────────────────────────────────────────────────
export interface ConfiguredRule { name: string; severity?: Severity; conditionsJson: unknown }

export function runValidations(rules: ConfiguredRule[], docsByType: DocsByType, now: Date = new Date(0)): ValidationResult[] {
  const out: ValidationResult[] = [];
  for (const r of rules) {
    const c = r.conditionsJson as ValidationRule | null;
    if (!c || typeof c !== "object" || !("kind" in c)) continue;
    let findings: Finding[] = [];
    switch (c.kind) {
      case "cross_reference":     findings = runCrossReference(c, docsByType); break;
      case "field_match":         findings = runFieldMatch(c, docsByType); break;
      case "clause_presence":     findings = runClause(c, docsByType); break;
      case "numeric_threshold":   findings = runThreshold(c, docsByType); break;
      case "date_rule":           findings = runDate(c, docsByType, now); break;
      case "field_format":        findings = runFormat(c, docsByType); break;
      case "document_required":   findings = runDocRequired(c, docsByType); break;
      case "signatures_complete": findings = runSignatures(c, docsByType); break;
      default: continue;
    }
    const severity = r.severity ?? "warn";
    for (const f of findings) out.push({ ...f, ruleName: r.name, severity });
  }
  return out;
}

// Overall case verdict for the semáforo: block > warn > ok.
export function caseVerdict(results: ValidationResult[]): "ok" | "warn" | "block" {
  let worst: "ok" | "warn" | "block" = "ok";
  for (const r of results) {
    if (r.ok === false && r.severity === "block") return "block";
    if (r.ok !== true && r.severity === "warn" && worst === "ok") worst = "warn";
  }
  return worst;
}
