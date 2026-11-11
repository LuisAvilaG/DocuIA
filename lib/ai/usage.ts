// Registro de cada llamada a un modelo (usage_events): cliente, modelo, tokens
// y de dónde viene. El cliente sale de un contexto que abre cada proceso
// (factura, caso, gasto, Archivo) con withAiUsage; las llamadas fuera de un
// contexto no se registran. Solo lo ve el superadmin (decisión 8 del plan).
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";
import { usageEvents } from "@/db/schema";

export type AiSource = "facturas" | "contratos" | "gastos" | "archivo";
interface AiUsageContext { orgId: string; source: AiSource }

const store = new AsyncLocalStorage<AiUsageContext>();

export function withAiUsage<T>(ctx: AiUsageContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

/** Contexto vigente (cliente y proceso) de la llamada en curso. */
export function currentAiUsage(): AiUsageContext | undefined {
  return store.getStore();
}

export interface AiCallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** Llamada resuelta por lote (mitad de precio). */
  batch?: boolean;
  /** Segundo modelo después de una lectura dudosa. */
  fallback?: boolean;
  /** Cliente explícito cuando no hay contexto (p. ej. resultados de un lote). */
  orgId?: string;
  source?: AiSource;
}

/** Quien quiera enterarse de cada llamada (p. ej. las comparaciones de modelos). */
export const aiUsageListeners = new Set<(u: AiCallUsage) => void>();

/** Guarda la llamada sin bloquear ni romper el proceso si falla. */
export function recordAiUsage(u: AiCallUsage): void {
  for (const listen of aiUsageListeners) listen(u);
  const ctx = store.getStore();
  const orgId = u.orgId ?? ctx?.orgId;
  if (!orgId) return;
  void db.insert(usageEvents).values({
    organizationId: orgId,
    eventType: u.fallback ? "ai_fallback_call" : "ai_primary_call",
    aiModel: u.model.slice(0, 120),
    tokensInput: Math.round(u.inputTokens) || 0,
    tokensOutput: Math.round(u.outputTokens) || 0,
    metadataJson: { source: u.source ?? ctx?.source ?? null, cached: u.cachedInputTokens ?? 0, batch: Boolean(u.batch) },
  }).catch((err) => console.warn("[ai/usage] no se pudo registrar", err instanceof Error ? err.message : err));
}

/** Tokens de una respuesta de Gemini (usageMetadata). */
export function geminiUsage(json: unknown): { inputTokens: number; outputTokens: number; cachedInputTokens: number } {
  const u = ((json as { usageMetadata?: Record<string, number> } | null)?.usageMetadata) ?? {};
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cachedInputTokens: u.cachedContentTokenCount ?? 0,
  };
}

/**
 * Precio por millón de tokens (USD). Claude: tarifas publicadas de la API
 * (nov 2026); Gemini: estimación de tarifas públicas, revisar al cambiar de plan.
 * Haiku 5.5 cuesta 5× más por encima de 100 mil tokens de entrada por llamada.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cachedInput: number; longInput?: { above: number; input: number; output: number } }> = {
  "claude-haiku-5-5": { input: 0.10, output: 0.50, cachedInput: 0.01, longInput: { above: 100_000, input: 0.50, output: 2.50 } },
  "claude-sonnet-5-5": { input: 2.00, output: 10.00, cachedInput: 0.10 },
  "gemini-2.5-flash": { input: 0.30, output: 2.50, cachedInput: 0.075 },
  "gemini-2.5-pro": { input: 1.25, output: 10.00, cachedInput: 0.31 },
};

/**
 * Costo estimado en USD; null si el modelo no tiene precio cargado. Con tokens
 * de una sola llamada el tramo largo se deduce solo; con totales de varias
 * llamadas hay que decir si eran llamadas largas (`longCalls`).
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0, batch = false, longCalls?: boolean): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const isLong = longCalls ?? inputTokens > (p.longInput?.above ?? Infinity);
  const long = p.longInput && isLong ? p.longInput : null;
  const inPrice = long?.input ?? p.input, outPrice = long?.output ?? p.output;
  const cached = Math.min(cachedInputTokens, inputTokens);
  const cost = ((inputTokens - cached) * inPrice + cached * p.cachedInput + outputTokens * outPrice) / 1_000_000;
  return batch ? cost / 2 : cost;
}
