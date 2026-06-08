import { like, eq, and, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  catalogItems, catalogVendors, catalogLocations, itemMappings,
} from "@/db/schema";
import { computeSimilarity, normalizeForLookup } from "./similarity";
import type {
  ExtractedInvoice, ExtractedLine, ItemOption, VendorOption, LocationOption,
  MatchedLine, UiPayload,
} from "./types";

// ── In-memory caches keyed by subsidiaryId ────────────────────────────────────

type ItemRow = {
  internal_id: string;
  itemid: string | null;
  name: string | null;
  type: string | null;
  unit: string | null;
  drtUnitId: string | null;
  drtUnitName: string | null;
};

type VendorRow = {
  internal_id: string;
  name: string | null;
  entityid: string | null;
};

const itemCache = new Map<string, { rows: ItemRow[]; ts: number }>();
const vendorCache = new Map<string, { rows: VendorRow[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function normalize(v: unknown): string {
  return String(v ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function toMoneyString(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v.toFixed(2);
}

// ── Items ─────────────────────────────────────────────────────────────────────

async function getAllItems(subsidiaryId: string): Promise<ItemRow[]> {
  const cached = itemCache.get(subsidiaryId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rows;

  const rows = await db
    .select({
      internal_id: catalogItems.internalId,
      itemid: catalogItems.itemid,
      name: catalogItems.name,
      type: catalogItems.type,
      unit: catalogItems.unit,
      drtUnitId: catalogItems.drtUnitId,
      drtUnitName: catalogItems.drtUnitName,
    })
    .from(catalogItems)
    .where(eq(catalogItems.subsidiaryId, subsidiaryId))
    .limit(8000);

  itemCache.set(subsidiaryId, { rows, ts: Date.now() });
  return rows;
}

function buildUnitIds(drtUnitId: string | null, drtUnitName: string | null, unit: string | null) {
  const ids = (drtUnitId || "").split(",").map((s) => normalize(s)).filter(Boolean);
  const names = (drtUnitName || "").split(",").map((s) => normalize(s)).filter(Boolean);
  const generic = normalize(unit || "");
  const unitNames = ids.map((id, i) => {
    const explicit = names[i] || "";
    return explicit && explicit !== id ? explicit : generic || id;
  });
  return { unitIds: ids, unitNames };
}

function itemRowToOption(row: ItemRow, score: number): ItemOption {
  const { unitIds, unitNames } = buildUnitIds(row.drtUnitId, row.drtUnitName, row.unit);
  return {
    internal_id: String(row.internal_id),
    itemid: String(row.itemid || ""),
    name: String(row.name || row.itemid || ""),
    type: String(row.type || ""),
    unit: String(row.unit || ""),
    unit_id: unitIds[0] || null,
    unit_ids: unitIds,
    unit_names: unitNames,
    _score: Number(score.toFixed(2)),
  };
}

function normalizeDesc(description: string): string {
  const raw = normalize(description);
  const leadMatch = raw.match(/^([A-Za-z0-9]{2,8})\s*(?:-\s*|\s+)(.+)$/);
  if (leadMatch) {
    const token = leadMatch[1];
    const rest = normalize(leadMatch[2]);
    const likelyCode = /\d/.test(token) || (token === token.toUpperCase() && token.length <= 4);
    if (likelyCode && rest) return rest;
  }
  return raw;
}

async function searchItems(query: string, subsidiaryId: string, limit = 10): Promise<ItemOption[]> {
  const term = normalizeDesc(query);
  if (!term) return [];

  const all = await getAllItems(subsidiaryId);
  const likeTerm = term.slice(0, 100).toLowerCase();

  const exact = all.filter((row) => {
    const name = (row.name || "").toLowerCase();
    const itemid = (row.itemid || "").toLowerCase();
    return (
      name.includes(likeTerm) ||
      itemid.includes(likeTerm) ||
      String(row.internal_id).toLowerCase() === likeTerm
    );
  });

  const fuzzy = all
    .map((row) => ({
      row,
      score: Math.max(
        computeSimilarity(term, row.name || ""),
        computeSimilarity(term, row.itemid || "")
      ),
    }))
    .filter((e) => e.score >= 0.22)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const seen = new Set<string>();
  const out: ItemOption[] = [];

  for (const row of exact) {
    const id = String(row.internal_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(itemRowToOption(row, 90));
    if (out.length >= limit) break;
  }
  for (const { row, score } of fuzzy) {
    const id = String(row.internal_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(itemRowToOption(row, score * 100));
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

async function getItemById(internalId: string, subsidiaryId: string): Promise<ItemOption | null> {
  const all = await getAllItems(subsidiaryId);
  const row = all.find((r) => String(r.internal_id) === internalId);
  return row ? itemRowToOption(row, 999) : null;
}

// ── Vendors ───────────────────────────────────────────────────────────────────

async function getAllVendors(subsidiaryId: string): Promise<VendorRow[]> {
  const cached = vendorCache.get(subsidiaryId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rows;

  const rows = await db
    .select({
      internal_id: catalogVendors.internalId,
      name: catalogVendors.name,
      entityid: catalogVendors.entityid,
    })
    .from(catalogVendors)
    .where(
      and(
        eq(catalogVendors.subsidiaryId, subsidiaryId),
        eq(catalogVendors.isInactive, false)
      )
    )
    .limit(10000);

  vendorCache.set(subsidiaryId, { rows, ts: Date.now() });
  return rows;
}

function vendorTokens(value: string): string[] {
  const STOP = new Set(["the", "and", "for", "with", "from", "food", "foods", "foodservice", "services"]);
  return normalizeForLookup(value)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function tokenCoverage(queryTokens: string[], target: string): number {
  if (!queryTokens.length) return 0;
  const tNorm = normalizeForLookup(target);
  let hits = 0;
  for (const token of queryTokens) {
    if (tNorm.includes(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

export async function searchVendors(query: string, subsidiaryId: string, limit = 20): Promise<VendorOption[]> {
  const term = normalize(query).slice(0, 250);
  if (!term) return [];

  const rows = await getAllVendors(subsidiaryId);
  const tokens = vendorTokens(term);
  const termNorm = normalizeForLookup(term);

  const scored = rows.map((row) => {
    const name = String(row.name || row.entityid || "");
    const nameNorm = normalizeForLookup(name);
    const entityNorm = normalizeForLookup(row.entityid || "");

    let score = 0;
    if (nameNorm === termNorm || entityNorm === termNorm) score += 220;
    else if (nameNorm.includes(termNorm) || entityNorm.includes(termNorm)) score += 100;
    score += Math.round(
      Math.max(
        computeSimilarity(termNorm, nameNorm),
        computeSimilarity(termNorm, entityNorm)
      ) * 100
    );
    score += Math.round(
      Math.max(tokenCoverage(tokens, name), tokenCoverage(tokens, row.entityid || "")) * 140
    );

    return {
      internal_id: String(row.internal_id),
      name,
      entityid: String(row.entityid || ""),
      _score: score,
    };
  })
    .filter((r) => r._score >= 40)
    .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ _score, ...v }) => v);

  return scored;
}

// ── Locations ─────────────────────────────────────────────────────────────────

export async function loadLocations(subsidiaryId: string, limit = 120): Promise<LocationOption[]> {
  const rows = await db
    .select({ internal_id: catalogLocations.internalId, name: catalogLocations.name })
    .from(catalogLocations)
    .where(
      and(
        eq(catalogLocations.subsidiaryId, subsidiaryId),
        eq(catalogLocations.isInactive, false)
      )
    )
    .limit(limit);

  return rows.map((r) => ({
    internal_id: String(r.internal_id),
    name: String(r.name || ""),
  }));
}

// ── Item mapping memory ───────────────────────────────────────────────────────

type MemorySuggestion = {
  netsuite_internal_id: string;
  netsuite_item_name: string | null;
  netsuite_unit: string | null;
  similarity: number;
  times_confirmed: number;
};

async function getMemorySuggestions(
  vendor: string,
  lineNames: string[],
  subsidiaryId: string
): Promise<Record<string, MemorySuggestion>> {
  if (!vendor || !lineNames.length) return {};

  const vendorNorm = normalizeForLookup(vendor);
  const rows = await db
    .select()
    .from(itemMappings)
    .where(
      and(
        eq(itemMappings.subsidiaryId, subsidiaryId),
        like(itemMappings.vendorNorm, `%${vendorNorm.slice(0, 60)}%`)
      )
    )
    .limit(500);

  const result: Record<string, MemorySuggestion> = {};

  for (const lineName of lineNames) {
    let bestScore = 0;
    let bestRow: typeof rows[number] | null = null;

    for (const row of rows) {
      const score = computeSimilarity(lineName, row.vendorItemName);
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }

    if (bestRow && bestScore >= 0.7) {
      result[lineName] = {
        netsuite_internal_id: bestRow.netsuiteInternalId,
        netsuite_item_name: bestRow.netsuiteItemName,
        netsuite_unit: bestRow.netsuiteUnit,
        similarity: bestScore,
        times_confirmed: bestRow.timesConfirmed,
      };
    }
  }

  return result;
}

// ── Main: build UI payload ────────────────────────────────────────────────────

export async function buildUiPayload(
  extracted: ExtractedInvoice,
  subsidiaryId: string,
  options?: { engine?: string; parserVersion?: string; meta?: Record<string, unknown> }
): Promise<UiPayload> {
  const engine = normalize(options?.engine || "") || "gemini_file_primary";
  const parserVersion = normalize(options?.parserVersion || "") || "invoice-gemini-file-tiered-v1";

  const vendors = await searchVendors(extracted.vendor, subsidiaryId, 20);
  const selectedVendor = vendors[0] || null;
  const vendorForMemory = normalize(selectedVendor?.name || extracted.vendor);

  const lineNames = extracted.lines.map((l) => normalize(l.description));
  const memorySuggestions = await getMemorySuggestions(vendorForMemory, lineNames, subsidiaryId);

  const itemCache2 = new Map<string, ItemOption[]>();
  const itemByIdCache2 = new Map<string, ItemOption | null>();

  const lines: MatchedLine[] = [];
  let totalLineConfidence = 0;

  for (const line of extracted.lines) {
    const key = normalize(line.description).toLowerCase();
    if (!itemCache2.has(key)) {
      itemCache2.set(key, await searchItems(line.description, subsidiaryId, 5));
    }
    const candidates = [...(itemCache2.get(key) || [])];
    const memorySuggestion = memorySuggestions[normalize(line.description)] || null;

    let selectedId = candidates.length === 1 ? String(candidates[0].internal_id) : "";
    let selectedItem = candidates.find((c) => c.internal_id === selectedId) || null;
    let matchStatus: MatchedLine["match_status"] =
      candidates.length === 0 ? "NOT_FOUND" : candidates.length === 1 ? "FOUND_SINGLE" : "FOUND_MULTIPLE";
    let recSource: "catalog" | "memory" = "catalog";
    let recConfidence: number | null = null;

    if (memorySuggestion?.netsuite_internal_id) {
      const mappedId = memorySuggestion.netsuite_internal_id;
      let memoryItem = candidates.find((c) => c.internal_id === mappedId) || null;

      if (!memoryItem) {
        if (!itemByIdCache2.has(mappedId)) {
          itemByIdCache2.set(mappedId, await getItemById(mappedId, subsidiaryId));
        }
        const fromDb = itemByIdCache2.get(mappedId);
        memoryItem = fromDb || {
          internal_id: mappedId,
          itemid: memorySuggestion.netsuite_item_name || "",
          name: memorySuggestion.netsuite_item_name || line.description,
          type: "", unit: "", unit_id: memorySuggestion.netsuite_unit,
          unit_ids: memorySuggestion.netsuite_unit ? [memorySuggestion.netsuite_unit] : [],
          unit_names: [],
          _score: 1000,
        };
      }

      if (memoryItem) {
        const already = candidates.some((c) => c.internal_id === mappedId);
        const enriched: ItemOption = {
          ...memoryItem,
          _score: 1000,
          memory_source: true,
        };
        if (!already) candidates.unshift(enriched);
        else {
          const idx = candidates.findIndex((c) => c.internal_id === mappedId);
          if (idx >= 0) candidates[idx] = { ...candidates[idx], ...enriched };
        }
        selectedId = mappedId;
        selectedItem = candidates.find((c) => c.internal_id === mappedId) || enriched;
        matchStatus = "FOUND_SINGLE";
        recSource = "memory";
        recConfidence = 1;
      }
    }

    if (candidates.length > 5) {
      const sel = candidates.find((c) => c.internal_id === selectedId);
      const rest = candidates.filter((c) => c.internal_id !== selectedId).slice(0, sel ? 4 : 5);
      candidates.splice(0, candidates.length, ...(sel ? [sel, ...rest] : rest));
    }

    let confidence = Number((
      (line.description ? 0.45 : 0) +
      (line.quantity !== null ? 0.15 : 0) +
      (line.rate !== null ? 0.15 : 0) +
      (line.amount !== null ? 0.2 : 0) +
      (candidates.length > 0 ? 0.05 : 0)
    ).toFixed(4));
    if (recSource === "memory") confidence = Math.max(confidence, 0.98);
    totalLineConfidence += confidence;

    const selUnitId = normalize(
      selectedItem?.unit_id || selectedItem?.unit_ids?.[0] || ""
    );

    lines.push({
      line_no: lines.length + 1,
      description: normalize(line.description),
      item_code: normalize(line.itemCode || ""),
      quantity: line.quantity ?? 1,
      rate: line.rate ?? null,
      amount: line.amount ?? (
        line.quantity !== null && line.rate !== null
          ? Number((line.quantity * line.rate).toFixed(2))
          : null
      ),
      uom: normalize(selectedItem?.unit_names?.[0] || line.uom || "") || null,
      candidates,
      selected_item_id: selectedId || null,
      selected_unit_id: selUnitId || null,
      match_status: matchStatus,
      recommendation_source: recSource,
      recommendation_confidence: recConfidence,
      confidence,
      bbox: line.bbox,
    });
  }

  const locations = await loadLocations(subsidiaryId);

  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const invoiceDate = extracted.invoiceDate || now;

  const headerConfidence = Number(
    ([
      Boolean(extracted.vendor),
      Boolean(extracted.invoiceNumber),
      Boolean(invoiceDate),
      extracted.total !== null,
    ].filter(Boolean).length / 4).toFixed(4)
  );
  const linesConfidence = lines.length > 0
    ? Number((totalLineConfidence / lines.length).toFixed(4))
    : 0;

  return {
    ok: true,
    type: "invoice_extraction",
    engine,
    format: extracted.format,
    generated_at: new Date().toISOString(),
    confidence: {
      header: headerConfidence,
      lines: linesConfidence,
      overall: Number((headerConfidence * 0.45 + linesConfidence * 0.55).toFixed(4)),
    },
    document: {
      vendor: {
        name: vendorForMemory || extracted.vendor || null,
        options: vendors,
        selected_internal_id: selectedVendor?.internal_id || null,
      },
      invoice_number: extracted.invoiceNumber || null,
      invoice_date: invoiceDate,
      due_date: extracted.dueDate || null,
      purchase_order: extracted.purchaseOrder || null,
      currency: extracted.currency || "USD",
      totals: {
        subtotal: toMoneyString(extracted.subtotal),
        tax: toMoneyString(extracted.tax) || "0.00",
        total: toMoneyString(extracted.total) || "0.00",
      },
      lines,
    },
    catalogs: { vendors, locations },
    meta: {
      parser_version: parserVersion,
      subsidiary_id: subsidiaryId,
      lines_count: lines.length,
      generated_date: now,
      ...(options?.meta || {}),
    },
  };
}
