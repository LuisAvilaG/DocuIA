/**
 * Finds which field makes NetSuite reject a vendor bill (e.g. the tax engine's
 * "entity: null"). Sends the same bill to the process RESTlet several times,
 * each time without one field, and stops at the first variant that saves.
 *
 * SANDBOX ONLY: it creates real vendor bills (dry run never reaches the tax
 * engine, which runs on save). Every attempt uses its own invoice number
 * (PROBE-…) so you can find and delete them afterwards.
 *
 * Credentials come from .env.netsuite (git-ignored) or the environment:
 *   NS_ACCOUNT_ID, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET,
 *   NS_PROCESS_SCRIPT (e.g. customscript3770), NS_PROCESS_DEPLOY (e.g. customdeploy1)
 *
 * Usage:  npx tsx scripts/ns-bill-probe.ts
 * Output: probe-result.json (responses only, no credentials).
 */
import { config } from "dotenv";
import { writeFileSync } from "fs";
import { buildOAuthHeader, buildRestletUrl, type NSCredentials } from "../lib/netsuite/oauth";

config({ path: ".env.netsuite", quiet: true });

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) { console.error(`Falta ${k} en .env.netsuite`); process.exit(1); }
  return v;
};

const creds: NSCredentials = {
  accountId: env("NS_ACCOUNT_ID"),
  consumerKey: env("NS_CONSUMER_KEY"),
  consumerSecret: env("NS_CONSUMER_SECRET"),
  tokenId: env("NS_TOKEN_ID"),
  tokenSecret: env("NS_TOKEN_SECRET"),
};
const url = buildRestletUrl(creds.accountId, env("NS_PROCESS_SCRIPT"), env("NS_PROCESS_DEPLOY"));

// The failing bill from the execution log (Sysco · MERA JFK T8 · NAYA JFK T8).
const stamp = Date.now().toString().slice(-6);
const base: Record<string, unknown> = {
  document_type: "invoice",
  dry_run: false,
  customform: "389",
  vendor_internal_id: "17612",
  subsidiary_internal_id: "58",
  po_internal_id: null,
  invoice_date: "24/01/2026",
  due_date: "27/01/2026",
  currency_internal_id: "USD",
  location_internal_id: "947",
  lines: [
    { item_internal_id: "47540", quantity: 1, rate: 29.27, amount: 29.27, description: "BBRLIMP CHEESE CHEDDAR SHARP YEL LOAF", unit: "1477", location: "947" },
  ],
};

type Variant = { name: string; change: (b: Record<string, unknown>) => void };
const variants: Variant[] = [
  { name: "tal cual (como lo manda DocuIA)", change: () => {} },
  { name: "sin formulario personalizado (customform)", change: (b) => { delete b.customform; } },
  { name: "sin fecha de vencimiento (due_date)", change: (b) => { b.due_date = null; } },
  { name: "sin moneda (currency)", change: (b) => { b.currency_internal_id = null; } },
  { name: "sin unidad en la línea", change: (b) => { (b.lines as Record<string, unknown>[]).forEach((l) => { delete l.unit; }); } },
  { name: "sin ubicación en encabezado (sí en línea)", change: (b) => { b.location_internal_id = null; } },
  { name: "sin formulario y sin fecha de vencimiento", change: (b) => { delete b.customform; b.due_date = null; } },
];

async function post(body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: buildOAuthHeader(url, "POST", creds), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) as Record<string, unknown> }; } catch { return { status: res.status, json: { raw: text.slice(0, 500) } }; }
}

async function main() {
  const results: unknown[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const body = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    v.change(body);
    body.invoice_number = `PROBE-${stamp}-${i + 1}`;
    body.external_id = `docuia-probe:${stamp}:${i + 1}`;
    process.stdout.write(`${i + 1}. ${v.name} … `);
    const r = await post(body);
    const ok = r.json.ok === true && Boolean(r.json.vendor_bill_internal_id);
    console.log(ok ? `SE GUARDÓ (factura ${r.json.vendor_bill_internal_id})` : `falló: ${String(r.json.message ?? r.json.error ?? r.status).slice(0, 160)}`);
    results.push({ variant: v.name, invoice_number: body.invoice_number, status: r.status, response: r.json });
    if (ok) {
      console.log(`\nEl problema está en lo que quitó la variante ${i + 1}: "${v.name}".`);
      break;
    }
  }
  writeFileSync("probe-result.json", JSON.stringify(results, null, 2));
  console.log("\nDetalle en probe-result.json. Borra en NetSuite las facturas PROBE-… que se hayan creado.");
}

main().catch((e) => { console.error("Error:", e instanceof Error ? e.message : e); process.exit(1); });
