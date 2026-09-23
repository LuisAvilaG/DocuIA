// Fiscal validation of a CFDI (XML method only): SAT status, receiver RFC,
// duplicate UUID and issuer RFC. The pure part decides the outcome; the
// pipeline supplies the lookups.

import type { SatStatus } from "./sat";

export interface SatValidationConfig {
  checkSatStatus:    boolean;
  checkReceiverRfc:  boolean;
  checkDuplicateUuid: boolean;
  checkIssuerRfc:    boolean;
  onCancelled:       "block" | "review";
  onSatUnavailable:  "review" | "continue";
}

export function parseSatValidationConfig(raw: unknown): SatValidationConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    checkSatStatus:     c.check_sat_status !== false,
    checkReceiverRfc:   c.check_receiver_rfc !== false,
    checkDuplicateUuid: c.check_duplicate_uuid !== false,
    checkIssuerRfc:     c.check_issuer_rfc !== false,
    onCancelled:        c.on_cancelled === "review" ? "review" : "block",
    onSatUnavailable:   c.on_sat_unavailable === "continue" ? "continue" : "review",
  };
}

export type CheckKey = "sat_status" | "receiver_rfc" | "duplicate_uuid" | "issuer_rfc";

export interface FiscalCheck {
  key:    CheckKey;
  /** true = passed, false = failed, null = could not be verified. */
  ok:     boolean | null;
  label:  string;
  detail: string;
}

export interface FiscalValidation {
  checkedAt: string;
  checks:    FiscalCheck[];
  outcome:   "ok" | "review" | "blocked";
  reason:    string | null;
}

export const normalizeRfc = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9&Ñ]/g, "");

export interface FiscalInputs {
  uuid:        string;
  emisorRfc:   string;
  receptorRfc: string;
  /** Result of the SAT query; an Error when the SAT could not be reached. */
  sat:         SatStatus | Error | null;
  subsidiaryTaxId: string | null;
  subsidiaryName:  string;
  duplicateOf:  { id: number; numDoc: string | null } | null;
  vendor:       { name: string; rfc: string | null } | null;
}

export function evaluateFiscalValidation(input: FiscalInputs, cfg: SatValidationConfig, now = new Date()): FiscalValidation {
  const checks: FiscalCheck[] = [];
  const blocking: string[] = [];
  const review: string[] = [];

  if (cfg.checkSatStatus) {
    if (input.sat instanceof Error || !input.sat) {
      checks.push({ key: "sat_status", ok: null, label: "Estado ante el SAT sin confirmar", detail: input.sat instanceof Error ? input.sat.message : "No se consultó" });
      if (cfg.onSatUnavailable === "review") review.push("no se pudo consultar el estado ante el SAT");
    } else {
      const vigente = input.sat.estado.toLowerCase() === "vigente";
      const efos = input.sat.validacionEfos && !/^200|no se encuentra/i.test(input.sat.validacionEfos) ? ` · EFOS: ${input.sat.validacionEfos}` : "";
      checks.push({
        key: "sat_status", ok: vigente,
        label: vigente ? "Vigente ante el SAT" : `${input.sat.estado} ante el SAT`,
        detail: [input.sat.codigoEstatus, input.sat.esCancelable].filter(Boolean).join(" · ") + efos,
      });
      if (!vigente) (cfg.onCancelled === "block" ? blocking : review).push(`CFDI ${input.sat.estado.toLowerCase()} ante el SAT`);
    }
  }

  if (cfg.checkReceiverRfc) {
    const expected = normalizeRfc(input.subsidiaryTaxId);
    const actual = normalizeRfc(input.receptorRfc);
    if (!expected) {
      checks.push({ key: "receiver_rfc", ok: null, label: "RFC receptor sin comparar", detail: `Configura el RFC de la subsidiaria ${input.subsidiaryName}` });
    } else {
      const ok = expected === actual;
      checks.push({
        key: "receiver_rfc", ok,
        label: ok ? "RFC receptor correcto" : "RFC receptor distinto",
        detail: ok ? `${actual} coincide con ${input.subsidiaryName}` : `El CFDI es para ${actual || "—"}; ${input.subsidiaryName} es ${expected}`,
      });
      if (!ok) blocking.push("el CFDI está emitido a otro RFC");
    }
  }

  if (cfg.checkDuplicateUuid) {
    const dup = input.duplicateOf;
    checks.push({
      key: "duplicate_uuid", ok: !dup,
      label: dup ? "UUID ya registrado" : "UUID no registrado antes",
      detail: dup ? `Ya se procesó como documento #${dup.id}${dup.numDoc ? ` (${dup.numDoc})` : ""}` : input.uuid,
    });
    if (dup) blocking.push("el UUID ya se registró");
  }

  if (cfg.checkIssuerRfc) {
    const vendorRfc = normalizeRfc(input.vendor?.rfc);
    if (!input.vendor || !vendorRfc) {
      checks.push({ key: "issuer_rfc", ok: null, label: "RFC emisor sin comparar", detail: input.vendor ? `${input.vendor.name} no tiene RFC en el ERP` : "Proveedor sin identificar" });
    } else {
      const ok = vendorRfc === normalizeRfc(input.emisorRfc);
      checks.push({
        key: "issuer_rfc", ok,
        label: ok ? "RFC emisor coincide con el proveedor" : "RFC emisor distinto al del proveedor",
        detail: `${normalizeRfc(input.emisorRfc)} · ${input.vendor.name}${ok ? "" : ` tiene ${vendorRfc}`}`,
      });
      if (!ok) review.push("el RFC emisor no coincide con el proveedor");
    }
  }

  const outcome = blocking.length ? "blocked" : review.length ? "review" : "ok";
  const reason = blocking.length ? blocking.join("; ") : review.length ? review.join("; ") : null;
  return { checkedAt: now.toISOString(), checks, outcome, reason };
}
