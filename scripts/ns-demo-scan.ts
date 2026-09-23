/**
 * Read-only scan of a NetSuite account to prepare AP demo cases (SuiteQL).
 * Only SELECT queries: it never creates or edits records.
 *
 * Credentials come from environment variables so they never live in the repo:
 *   NS_ACCOUNT_ID, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET
 * Optional: NS_SUBSIDIARY (name to look for, default "MERA TOTAL").
 *
 * Usage:  npx tsx scripts/ns-demo-scan.ts
 * Output: demo-scan.json in the project root (business data only, no credentials).
 *
 * The role needs "REST Web Services" and "SuiteAnalytics Workbook" permissions.
 */
import { writeFileSync } from "fs";
import { buildOAuthHeader, type NSCredentials } from "../lib/netsuite/oauth";

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) { console.error(`Falta la variable de entorno ${k}`); process.exit(1); }
  return v;
};

const creds: NSCredentials = {
  accountId: env("NS_ACCOUNT_ID"),
  consumerKey: env("NS_CONSUMER_KEY"),
  consumerSecret: env("NS_CONSUMER_SECRET"),
  tokenId: env("NS_TOKEN_ID"),
  tokenSecret: env("NS_TOKEN_SECRET"),
};
const SUB_NAME = (process.env.NS_SUBSIDIARY ?? "MERA TOTAL").toUpperCase().replace(/'/g, "");
const host = creds.accountId.toLowerCase().replace(/_/g, "-");
const URL_QL = `https://${host}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

type Row = Record<string, unknown>;

async function ql(q: string, limit = 1000): Promise<Row[]> {
  const url = `${URL_QL}?limit=${limit}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildOAuthHeader(url, "POST", creds),
      "Content-Type": "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify({ q }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({})) as { items?: Row[]; "o:errorDetails"?: { detail?: string }[] };
  if (!res.ok) throw new Error(json["o:errorDetails"]?.[0]?.detail ?? `HTTP ${res.status}`);
  return (json.items ?? []).map(({ links: _l, ...r }) => r);
}

/** Runs the first query variant that works (some fields do not exist in every account). */
async function tryQl(label: string, variants: string[], limit?: number): Promise<{ rows: Row[]; error?: string }> {
  let last = "";
  for (const q of variants) {
    try { return { rows: await ql(q, limit) }; } catch (e) { last = e instanceof Error ? e.message : String(e); }
  }
  console.warn(`  ! ${label}: ${last}`);
  return { rows: [], error: last };
}

async function main() {
  console.log(`Buscando la subsidiaria "${SUB_NAME}"…`);
  const subs = await tryQl("subsidiaria", [
    `SELECT id, name, federalidnumber, BUILTIN.DF(currency) AS currency, country FROM subsidiary WHERE UPPER(name) LIKE '%${SUB_NAME}%'`,
    `SELECT id, name, BUILTIN.DF(currency) AS currency, country FROM subsidiary WHERE UPPER(name) LIKE '%${SUB_NAME}%'`,
  ]);
  const sub = subs.rows[0];
  if (!sub) { console.error("No se encontró la subsidiaria. Revisa NS_SUBSIDIARY."); process.exit(1); }
  const subId = String(sub.id);
  console.log(`  → ${sub.name} (id ${subId})`);

  const mainline = `JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' AND tl.subsidiary = ${subId}`;

  console.log("Proveedores con más facturas (12 meses)…");
  const topVendors = await tryQl("proveedores", [
    `SELECT t.entity AS vendor_id, BUILTIN.DF(t.entity) AS vendor, COUNT(*) AS bills, SUM(t.foreigntotal) AS total
       FROM transaction t ${mainline}
      WHERE t.type = 'VendBill' AND t.trandate >= ADD_MONTHS(SYSDATE, -12)
      GROUP BY t.entity, BUILTIN.DF(t.entity) ORDER BY COUNT(*) DESC`,
  ], 30);

  console.log("Órdenes de compra abiertas…");
  const openPOs = await tryQl("OC abiertas", [
    `SELECT t.id, t.tranid, t.trandate, t.entity AS vendor_id, BUILTIN.DF(t.entity) AS vendor,
            BUILTIN.DF(t.status) AS status, t.status AS status_code, t.foreigntotal AS total, BUILTIN.DF(t.currency) AS currency
       FROM transaction t ${mainline}
      WHERE t.type = 'PurchOrd' AND t.status IN ('PurchOrd:B', 'PurchOrd:D', 'PurchOrd:E', 'PurchOrd:F')
      ORDER BY t.trandate DESC`,
  ], 200);

  const vendorIds = [...new Set([
    ...topVendors.rows.map((r) => String(r.vendor_id)),
    ...openPOs.rows.map((r) => String(r.vendor_id)),
  ])].filter((id) => /^\d+$/.test(id)).slice(0, 60);

  console.log("Datos de proveedores…");
  const vendors = vendorIds.length ? await tryQl("datos de proveedores", [
    `SELECT id, entityid, companyname, BUILTIN.DF(category) AS category, category AS category_id, email, taxidnum AS rfc, isinactive FROM vendor WHERE id IN (${vendorIds.join(",")})`,
    `SELECT id, entityid, companyname, BUILTIN.DF(category) AS category, category AS category_id, email, isinactive FROM vendor WHERE id IN (${vendorIds.join(",")})`,
  ]) : { rows: [] };

  const poIds = openPOs.rows.slice(0, 40).map((r) => String(r.id)).filter((id) => /^\d+$/.test(id));
  console.log("Líneas de las OC (recibido / facturado)…");
  const poLines = poIds.length ? await tryQl("líneas de OC", [
    `SELECT tl.transaction AS po_id, tl.linesequencenumber AS line, tl.item AS item_id, BUILTIN.DF(tl.item) AS item,
            tl.memo AS description, tl.quantity, tl.quantityshiprecv AS received, tl.quantitybilled AS billed,
            tl.rate, tl.foreignamount AS amount, BUILTIN.DF(tl.units) AS units, tl.isclosed AS closed
       FROM transactionline tl
      WHERE tl.transaction IN (${poIds.join(",")}) AND tl.mainline = 'F' AND tl.taxline = 'F' AND tl.item IS NOT NULL
      ORDER BY tl.transaction, tl.linesequencenumber`,
  ], 1000) : { rows: [] };

  console.log("Facturas de proveedor recientes…");
  const recentBills = await tryQl("facturas recientes", [
    `SELECT t.id, t.tranid, t.trandate, BUILTIN.DF(t.entity) AS vendor, t.foreigntotal AS total, BUILTIN.DF(t.currency) AS currency, BUILTIN.DF(t.status) AS status
       FROM transaction t ${mainline}
      WHERE t.type = 'VendBill' ORDER BY t.trandate DESC`,
  ], 30);

  console.log("Campos del CFDI y carpetas…");
  const cfdiFields = await tryQl("campos CFDI", [
    `SELECT scriptid, name FROM customfield WHERE UPPER(scriptid) LIKE 'CUSTBODY_MX%' OR UPPER(scriptid) LIKE '%UUID%' OR UPPER(scriptid) LIKE '%CFDI%'`,
  ], 100);
  const folders = await tryQl("carpetas", [
    `SELECT id, name, BUILTIN.DF(parent) AS parent FROM mediaitemfolder ORDER BY id`,
  ], 200);

  // Summary per open PO: how much is received and billed, to pick demo cases.
  const byPo = new Map<string, Row[]>();
  for (const l of poLines.rows) byPo.set(String(l.po_id), [...(byPo.get(String(l.po_id)) ?? []), l]);
  const poSummary = openPOs.rows.map((po) => {
    const lines = byPo.get(String(po.id)) ?? [];
    const n = (v: unknown) => Math.abs(Number(v) || 0);
    const qty = lines.reduce((s, l) => s + n(l.quantity), 0);
    const received = lines.reduce((s, l) => s + n(l.received), 0);
    const billed = lines.reduce((s, l) => s + n(l.billed), 0);
    return { ...po, lines: lines.length, qty, received, billed, receivedPct: qty ? Math.round((received / qty) * 100) : null };
  });

  const out = {
    scannedAt: new Date().toISOString(),
    account: creds.accountId,
    subsidiary: sub,
    topVendors: topVendors.rows,
    vendors: vendors.rows,
    openPurchaseOrders: poSummary,
    purchaseOrderLines: poLines.rows,
    recentBills: recentBills.rows,
    cfdiFields: cfdiFields.rows,
    folders: folders.rows,
    errors: Object.fromEntries(Object.entries({ subs, topVendors, openPOs, vendors, poLines, recentBills, cfdiFields, folders })
      .filter(([, v]) => "error" in v && v.error).map(([k, v]) => [k, (v as { error?: string }).error])),
  };
  writeFileSync("demo-scan.json", JSON.stringify(out, null, 2));
  console.log(`\nListo: demo-scan.json — ${poSummary.length} OC abiertas, ${vendors.rows.length} proveedores, ${recentBills.rows.length} facturas recientes.`);
}

main().catch((e) => { console.error("Error:", e instanceof Error ? e.message : e); process.exit(1); });
