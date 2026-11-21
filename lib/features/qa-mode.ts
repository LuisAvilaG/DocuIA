// Modo QA (decisiones 4 y 5 del plan del rediseño): solo con el ERP en sandbox,
// dura 7 días por defecto y como máximo 30. Funciones puras; la consulta a la base
// vive en qa-mode-state.ts.

import { dayIn, safeTimeZone } from "@/lib/time-zone";

export const QA_DEFAULT_DAYS = 7;
export const QA_MAX_DAYS = 30;
const DAY_MS = 86_400_000;
const SUFFIX_RE = /^[A-Za-z0-9_-]*\{n\}[A-Za-z0-9_-]*$/;
const APPLIES_TO = new Set(["invoices", "invoices_and_po"]);

export interface QaConfig {
  applies_to: "invoices" | "invoices_and_po";
  number_suffix: string;
  skip_duplicates: boolean;
  expires_on: string; // AAAA-MM-DD, inclusivo
}

/** Fecha AAAA-MM-DD (UTC) de `now` más `days` días. */
export function isoDay(now: Date, days = 0): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function validDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Valida la configuración al encender el modo QA desde el superadmin y completa
 * la fecha de vencimiento si viene vacía.
 */
export function normalizeQaConfig(
  raw: Record<string, unknown>,
  environment: string | null | undefined,
  now = new Date(),
): { ok: true; config: QaConfig } | { ok: false; error: string } {
  if (environment !== "sandbox") {
    return { ok: false, error: "El modo QA solo se puede encender con el ERP del cliente en sandbox." };
  }
  const applies = String(raw.applies_to ?? "invoices");
  if (!APPLIES_TO.has(applies)) return { ok: false, error: "«Aplica a» no es válido." };

  const suffix = String(raw.number_suffix ?? "-QA{n}").trim();
  if (suffix.length > 12 || !SUFFIX_RE.test(suffix)) {
    return { ok: false, error: "El sufijo debe incluir {n} una vez, usar solo letras, números, - o _ y tener hasta 12 caracteres." };
  }

  const today = isoDay(now);
  const max = isoDay(now, QA_MAX_DAYS);
  let expires = String(raw.expires_on ?? "").trim();
  if (!expires) expires = isoDay(now, QA_DEFAULT_DAYS);
  if (!validDay(expires)) return { ok: false, error: "La fecha de vencimiento debe ser AAAA-MM-DD." };
  if (expires < today) return { ok: false, error: "La fecha de vencimiento ya pasó." };
  if (expires > max) return { ok: false, error: `El modo QA dura como máximo ${QA_MAX_DAYS} días (hasta ${max}).` };

  return {
    ok: true,
    config: {
      applies_to: applies as QaConfig["applies_to"],
      number_suffix: suffix,
      skip_duplicates: raw.skip_duplicates !== false,
      expires_on: expires,
    },
  };
}

/** Si el modo QA está vigente: concedido, ERP en sandbox y sin vencer. */
export function qaModeActive(
  granted: boolean,
  config: Record<string, unknown> | null | undefined,
  environment: string | null | undefined,
  now = new Date(),
  /** The client's zone: the last day ends at its midnight, not at UTC's (6 pm in Mexico). */
  timeZone?: string | null,
): boolean {
  if (!granted || environment !== "sandbox") return false;
  const expires = String(config?.expires_on ?? "");
  return validDay(expires) && expires >= (timeZone ? dayIn(safeTimeZone(timeZone), now) : isoDay(now));
}

/** Número del documento enviado en modo QA: «F-1001» + «-QA{n}» → «F-1001-QA2». */
export function qaDocumentNumber(base: string, suffix: string, n: number): string {
  return `${base}${suffix.replace("{n}", String(n))}`;
}
