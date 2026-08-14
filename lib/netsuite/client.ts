import { buildOAuthHeader, buildRestApiUrl, buildRestletUrl, NSCredentials } from "./oauth";

export type NSEnvironment = "sandbox" | "production";

// Hard cap on any single NetSuite HTTP call so a slow/hung NS can never block
// a request (or a queued job) indefinitely.
const NS_TIMEOUT_MS = Number(process.env.NETSUITE_TIMEOUT_MS) || 30_000;

export interface NSRestletResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface NSSubsidiary {
  internal_id: string;
  name: string;
  country: string;
  currency: string;
}

export interface NSCatalogItem {
  internal_id: string;
  itemid: string;
  name: string;
  type: string;
  unit: string;
  drt_unit_uom_id: string;
  drt_unit_uom_name: string;
  inactive: boolean;
}

export interface NSVendor {
  internal_id: string;
  entityid: string;
  name: string;
  email: string;
  phone: string;
  rfc: string;
  inactive: boolean;
}

export interface NSLocation {
  internal_id: string;
  name: string;
  full_name: string;
  inactive: boolean;
}

export interface NSPagedResult<T> {
  ok: boolean;
  type: string;
  page_index: number;
  page_size: number;
  page_count: number;
  total_count: number;
  results: T[];
}

export interface NSOpenPurchaseOrder {
  internal_id: string;
  tranid: string;
  date: string;
  total: string;
  currency: string;
  status: string;
}

async function nsGet(url: string, creds: NSCredentials): Promise<Response> {
  const authHeader = buildOAuthHeader(url, "GET", creds);
  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(NS_TIMEOUT_MS),
  });
}

async function nsPost(url: string, body: unknown, creds: NSCredentials, timeoutMs = NS_TIMEOUT_MS): Promise<Response> {
  const authHeader = buildOAuthHeader(url, "POST", creds);
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function testNsCredentials(
  creds: NSCredentials,
): Promise<NSRestletResult<{ accountId: string }>> {
  const url = `${buildRestApiUrl(creds.accountId)}/vendor?limit=1`;
  try {
    const res = await nsGet(url, creds);
    if (res.ok || res.status === 403) {
      // 403 means credentials are valid but user lacks record access — still a pass
      return { ok: true, data: { accountId: creds.accountId }, status: res.status };
    }
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function probeCatalogScript(
  creds: NSCredentials,
  scriptId: string,
  deployId: string,
): Promise<NSRestletResult<{ version: string }>> {
  const url = buildRestletUrl(creds.accountId, scriptId, deployId);
  const pingUrl = `${url}&type=ping`;
  try {
    const res = await nsGet(pingUrl, creds);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.message || json.error || "Script returned error" };
    return { ok: true, data: { version: json.version ?? "unknown" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchNsSubsidiaries(
  creds: NSCredentials,
  scriptId: string,
  deployId: string,
): Promise<NSRestletResult<NSSubsidiary[]>> {
  const url = buildRestletUrl(creds.accountId, scriptId, deployId);
  try {
    const res = await nsPost(url, { type: "subsidiaries" }, creds);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.message || json.error || "Catalog script error" };
    return { ok: true, data: json.results ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchCatalogPage(
  creds: NSCredentials,
  scriptId: string,
  deployId: string,
  type: "items" | "vendors" | "locations",
  subsidiaryId: string,
  pageIndex: number,
  pageSize = 500,
  timeoutMs = NS_TIMEOUT_MS,
  serviceCategoryId?: string,
): Promise<NSRestletResult<NSPagedResult<NSCatalogItem | NSVendor | NSLocation>>> {
  const url = buildRestletUrl(creds.accountId, scriptId, deployId);
  const body = {
    type,
    subsidiary_id: subsidiaryId,
    page_index: pageIndex,
    page_size: pageSize,
    // Locations in NetSuite are account-wide unless we ask the RESTlet to filter
    // them by subsidiary; without this every subsidiary would pull the full list.
    filter_locations_by_subsidiary: true,
    ...(serviceCategoryId ? { service_category_id: serviceCategoryId } : {}),
  };
  try {
    const res = await nsPost(url, body, creds, timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.message || json.error || "Catalog script error" };
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchOpenPurchaseOrders(
  creds: NSCredentials,
  scriptId: string,
  deployId: string,
  subsidiaryId: string,
  vendorId: string,
): Promise<NSRestletResult<NSOpenPurchaseOrder[]>> {
  const url = buildRestletUrl(creds.accountId, scriptId, deployId);
  try {
    const res = await nsPost(url, {
      type: "open_purchase_orders",
      subsidiary_id: subsidiaryId,
      vendor_id: vendorId,
      page_index: 0,
      page_size: 100,
    }, creds);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.message || json.error || "Catalog script error" };
    return { ok: true, data: json.results ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Pulls a human-readable message out of a RESTlet error reply, which may be a
// string, { error: "..." }, { message: "..." }, or the NetSuite-native shape
// { error: { code, message } }.
function extractNsError(json: unknown): string {
  const j = json as Record<string, unknown> | null;
  const e = j?.error ?? j?.message ?? j;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const msg = [o.message, o.code, o.detail].find(v => typeof v === "string" && v.trim());
    if (typeof msg === "string") return msg;
  }
  try { return JSON.stringify(json).slice(0, 300); } catch { return "NetSuite process restlet returned error"; }
}

export async function processDocument(
  creds: NSCredentials,
  scriptId: string,
  deployId: string,
  payload: Record<string, unknown>,
): Promise<NSRestletResult<Record<string, unknown>>> {
  const url = buildRestletUrl(creds.accountId, scriptId, deployId);
  try {
    const res = await nsPost(url, payload, creds);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status };
    }
    const json = await res.json();
    // A 200 can still carry a RESTlet-level failure ({ ok:false, error/message }).
    // Surface that message instead of losing it behind a generic error.
    if (json && json.ok === false) {
      return { ok: false, error: extractNsError(json), status: res.status, data: json };
    }
    return { ok: json.ok ?? true, data: json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
