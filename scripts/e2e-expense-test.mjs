/**
 * E2E test for Expense AI module
 * Run: node scripts/e2e-expense-test.mjs
 */
const BASE = "http://localhost:3000";

class CookieJar {
  constructor() { this.cookies = {}; }

  update(setCookieHeader) {
    if (!setCookieHeader) return;
    // handle both comma-separated and single header
    const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const chunk of raw) {
      // each Set-Cookie entry is separated by a comma only between DISTINCT cookies
      // but dates also have commas, so we split on "; " boundaries for the name=value part
      const [pair] = chunk.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx < 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const val  = pair.slice(eqIdx + 1).trim();
      if (name) this.cookies[name] = val;
    }
  }

  header() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function req(method, path, body, jar) {
  const headers = { "Content-Type": "application/json" };
  if (jar) headers["Cookie"] = jar.header();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  if (jar) {
    const sc = res.headers.get("set-cookie");
    if (sc) jar.update(sc);
  }

  let data = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch {}
  } else if (ct.includes("text/csv")) {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers };
}

let passed = 0, failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════");
console.log("  DocuIA Expense AI — E2E Test Suite");
console.log("══════════════════════════════════════════\n");

// ── TEST 1: Login as Acme tenant admin ─────────────────────────────────────────
console.log("TEST 1: Login as Acme admin (carlos@acme.mx)");
const jar = new CookieJar();
const loginRes = await req("POST", "/api/v1/auth/login",
  { email: "carlos@acme.mx", password: "Demo1234!" }, jar);
check("Login returns 200", loginRes.status === 200, `got ${loginRes.status}`);
check("Returns ok:true", loginRes.data?.ok === true);
check("Cookie set", Object.keys(jar.cookies).includes("access_token"),
  `cookies: ${Object.keys(jar.cookies).join(", ")}`);

// ── TEST 2: Feature gate allows access (expense_management granted) ────────────
console.log("\nTEST 2: Feature gate allows access");
const gateRes = await req("GET", "/api/v1/expenses/reports", null, jar);
check("Reports endpoint 200 (feature enabled)", gateRes.status === 200, `got ${gateRes.status} — ${JSON.stringify(gateRes.data)}`);
check("Reports array returned", Array.isArray(gateRes.data?.reports));

// ── TEST 3: Create expense report ─────────────────────────────────────────────
console.log("\nTEST 3: Create expense report");
const reportRes = await req("POST", "/api/v1/expenses/reports", {
  purpose:     "Visita cliente - E2E Test",
  periodStart: "2026-05-01",
  periodEnd:   "2026-05-15",
}, jar);
check("Create report returns 201", reportRes.status === 201, `got ${reportRes.status} — ${JSON.stringify(reportRes.data)}`);
const reportId = reportRes.data?.reportId;
check("Report ID returned", !!reportId, `data: ${JSON.stringify(reportRes.data)}`);

// ── TEST 4: Catalog endpoints ──────────────────────────────────────────────────
console.log("\nTEST 4: Catalog endpoints");
const [catRes, deptRes, classRes] = await Promise.all([
  req("GET", "/api/v1/expenses/categories", null, jar),
  req("GET", "/api/v1/expenses/departments", null, jar),
  req("GET", "/api/v1/expenses/classes", null, jar),
]);
check("Categories 200", catRes.status === 200, `got ${catRes.status} — ${JSON.stringify(catRes.data)}`);
check("Departments 200", deptRes.status === 200, `got ${deptRes.status}`);
check("Classes 200", classRes.status === 200, `got ${classRes.status}`);

// ── TEST 5: Add expense item ───────────────────────────────────────────────────
console.log("\nTEST 5: Add expense item");
let itemId = null;
if (reportId) {
  const itemRes = await req("POST", "/api/v1/expenses/items", {
    reportId,
    vendorName:           "Papelería Central",
    vendorNit:            "900123456-7",
    invoiceNumber:        "FE-2026-001",
    invoiceDate:          "2026-05-10",
    subtotal:             100000,
    taxAmount:            19000,
    retentionAmount:      0,
    total:                119000,
    currency:             "COP",
    paymentMethod:        "personal",
    description:          "Papelería para oficina",
    documentTypeDetected: "invoice",
  }, jar);
  check("Add item returns 201", itemRes.status === 201,
    `got ${itemRes.status} — ${JSON.stringify(itemRes.data)}`);
  itemId = itemRes.data?.itemId;
  check("Item ID returned", !!itemId, `data: ${JSON.stringify(itemRes.data)}`);
} else {
  check("Add item (skipped — no reportId)", false);
  check("Item ID returned (skipped)", false);
}

// ── TEST 6: Validate item ─────────────────────────────────────────────────────
console.log("\nTEST 6: Validate expense item");
const valRes = await req("POST", "/api/v1/expenses/validate", {
  vendorNit: "900123456-7",
  country:   "CO",
  taxAmount: 19000,
  subtotal:  100000,
}, jar);
check("Validate returns 200", valRes.status === 200,
  `got ${valRes.status} — ${JSON.stringify(valRes.data)}`);
check("Validation returns ok + warnings array",
  valRes.data?.ok === true && Array.isArray(valRes.data?.warnings),
  `data: ${JSON.stringify(valRes.data)}`);

// ── TEST 7: Get report by ID ───────────────────────────────────────────────────
console.log("\nTEST 7: Get report detail");
if (reportId) {
  const detRes = await req("GET", `/api/v1/expenses/reports/${reportId}`, null, jar);
  check("Report detail 200", detRes.status === 200,
    `got ${detRes.status} — ${JSON.stringify(detRes.data)}`);
  check("Report has items array", Array.isArray(detRes.data?.report?.items),
    `report keys: ${Object.keys(detRes.data?.report ?? {}).join(", ")}`);
  check("Report status is draft", detRes.data?.report?.status === "draft",
    `status: ${detRes.data?.report?.status}`);
} else {
  check("Report detail (skipped)", false); check("Has items", false); check("Status draft", false);
}

// ── TEST 8: Submit report ─────────────────────────────────────────────────────
console.log("\nTEST 8: Submit expense report");
if (reportId && itemId) {
  const submitRes = await req("POST", `/api/v1/expenses/reports/${reportId}/submit`, {}, jar);
  check("Submit returns 200", submitRes.status === 200,
    `got ${submitRes.status} — ${JSON.stringify(submitRes.data)}`);
  check("Submit returns ok:true", submitRes.data?.ok === true,
    `data: ${JSON.stringify(submitRes.data)}`);
  // Verify by re-fetching
  const afterSub = await req("GET", `/api/v1/expenses/reports/${reportId}`, null, jar);
  check("Status changed to submitted", afterSub.data?.report?.status === "submitted",
    `status: ${afterSub.data?.report?.status}`);
} else {
  check("Submit (skipped)", false); check("Submit ok", false); check("Status submitted", false);
}

// ── TEST 9: Accounting view shows submitted report ─────────────────────────────
console.log("\nTEST 9: Accounting view");
const accRes = await req("GET", "/api/v1/expenses/reports?view=accounting", null, jar);
check("Accounting view 200", accRes.status === 200, `got ${accRes.status}`);
check("Contains submitted report", (accRes.data?.reports ?? []).some(r => r.id === reportId),
  `total reports: ${accRes.data?.reports?.length}`);

// ── TEST 10: Approve report ────────────────────────────────────────────────────
console.log("\nTEST 10: Approve expense report");
if (reportId) {
  const approveRes = await req("POST", `/api/v1/expenses/reports/${reportId}/approve`, {}, jar);
  check("Approve returns 200", approveRes.status === 200,
    `got ${approveRes.status} — ${JSON.stringify(approveRes.data)}`);
  check("Approve returns ok:true", approveRes.data?.ok === true);
  // Verify
  const afterAp = await req("GET", `/api/v1/expenses/reports/${reportId}`, null, jar);
  check("Status changed to approved", afterAp.data?.report?.status === "approved",
    `status: ${afterAp.data?.report?.status}`);
} else {
  check("Approve (skipped)", false); check("Approve ok", false); check("Status approved", false);
}

// ── TEST 11: Cannot approve twice ─────────────────────────────────────────────
console.log("\nTEST 11: Double-approve rejected");
if (reportId) {
  const dupRes = await req("POST", `/api/v1/expenses/reports/${reportId}/approve`, {}, jar);
  check("Double-approve returns 409", dupRes.status === 409,
    `got ${dupRes.status} — ${JSON.stringify(dupRes.data)}`);
}

// ── TEST 12: Create + submit + reject flow ────────────────────────────────────
console.log("\nTEST 12: Create + submit + reject flow");
let rejectReportId = null;
{
  const r2 = await req("POST", "/api/v1/expenses/reports", {
    purpose: "Viaje a Bogotá - para rechazar",
    periodStart: "2026-05-01",
    periodEnd:   "2026-05-15",
  }, jar);
  rejectReportId = r2.data?.reportId;
  check("Created second report", !!rejectReportId, `data: ${JSON.stringify(r2.data)}`);

  if (rejectReportId) {
    // Add an item
    const ri = await req("POST", "/api/v1/expenses/items", {
      reportId:      rejectReportId,
      vendorName:    "Aerolíneas Test",
      total:         500000,
      subtotal:      420168,
      taxAmount:     79832,
      currency:      "COP",
      paymentMethod: "personal",
    }, jar);
    check("Item added to second report", ri.status === 201, `got ${ri.status}`);

    // Submit
    const s2 = await req("POST", `/api/v1/expenses/reports/${rejectReportId}/submit`, {}, jar);
    check("Second report submitted", s2.status === 200, `got ${s2.status} — ${JSON.stringify(s2.data)}`);

    // Reject
    const rejectRes = await req("POST", `/api/v1/expenses/reports/${rejectReportId}/reject`,
      { reason: "Documentos incompletos — falta factura escaneada" }, jar);
    check("Reject returns 200", rejectRes.status === 200,
      `got ${rejectRes.status} — ${JSON.stringify(rejectRes.data)}`);
    check("Reject returns ok:true", rejectRes.data?.ok === true);

    // Verify status
    const afterRej = await req("GET", `/api/v1/expenses/reports/${rejectReportId}`, null, jar);
    check("Status changed to rejected", afterRej.data?.report?.status === "rejected",
      `status: ${afterRej.data?.report?.status}`);
    check("Rejection reason stored", !!afterRej.data?.report?.rejectedReason,
      `reason: ${afterRej.data?.report?.rejectedReason}`);
  }
}

// ── TEST 13: Reject without reason = 400 ─────────────────────────────────────
console.log("\nTEST 13: Reject without reason returns 400");
if (rejectReportId) {
  // Report is already rejected, so it's 409 (wrong state), but we can test on approve-endpoint
  // Instead, create a dummy report in submitted state and test empty reason
  const r3 = await req("POST", "/api/v1/expenses/reports", { purpose: "Test rechazo sin motivo" }, jar);
  const r3id = r3.data?.reportId;
  if (r3id) {
    await req("POST", "/api/v1/expenses/items", {
      reportId: r3id, vendorName: "X", total: 1000, subtotal: 840, taxAmount: 160,
      currency: "COP", paymentMethod: "personal",
    }, jar);
    await req("POST", `/api/v1/expenses/reports/${r3id}/submit`, {}, jar);
    const noReasonRes = await req("POST", `/api/v1/expenses/reports/${r3id}/reject`, { reason: "" }, jar);
    check("Reject with empty reason = 400", noReasonRes.status === 400,
      `got ${noReasonRes.status} — ${JSON.stringify(noReasonRes.data)}`);
  }
}

// ── TEST 14: NS Sync (graceful failure without real NS creds) ─────────────────
console.log("\nTEST 14: NetSuite sync (graceful failure expected)");
if (reportId) {
  const syncRes = await req("POST", `/api/v1/expenses/reports/${reportId}/sync`, {}, jar);
  check("Sync returns a response", [200, 207, 400, 500].includes(syncRes.status),
    `got ${syncRes.status}`);
  const hasResult = syncRes.data?.ok !== undefined || syncRes.data?.error !== undefined;
  check("Sync returns a result object", hasResult, `data: ${JSON.stringify(syncRes.data)}`);
}

// ── TEST 15: CSV Export ───────────────────────────────────────────────────────
console.log("\nTEST 15: CSV Export");
const exportRes = await req("GET", "/api/v1/expenses/reports/export", null, jar);
check("Export returns 200", exportRes.status === 200, `got ${exportRes.status}`);
check("Response is CSV with INFORMES section",
  typeof exportRes.data === "string" && exportRes.data.includes("INFORMES"),
  `data type: ${typeof exportRes.data}, starts with: ${String(exportRes.data).slice(0, 50)}`);
check("CSV contains our report purpose",
  typeof exportRes.data === "string" && exportRes.data.includes("Visita cliente"),
  "purpose not found in CSV");

// ── TEST 16: Route protection ─────────────────────────────────────────────────
console.log("\nTEST 16: Route protection");
const emptyJar = new CookieJar();
const noAuthRes = await req("GET", "/api/v1/expenses/reports", null, emptyJar);
check("No-auth request returns 401", noAuthRes.status === 401, `got ${noAuthRes.status}`);

const noAuthApprove = await req("POST", `/api/v1/expenses/reports/${reportId}/approve`, {}, emptyJar);
check("Approve without auth returns 401", noAuthApprove.status === 401, `got ${noAuthApprove.status}`);

// ── TEST 17: Delete item (from draft report) ──────────────────────────────────
console.log("\nTEST 17: Delete expense item");
{
  const draftR = await req("POST", "/api/v1/expenses/reports", {
    purpose: "Draft para borrar item",
  }, jar);
  const draftId = draftR.data?.reportId;

  if (draftId) {
    const draftItem = await req("POST", "/api/v1/expenses/items", {
      reportId:      draftId,
      vendorName:    "Test Vendor",
      total:         50000,
      subtotal:      42017,
      taxAmount:     7983,
      currency:      "COP",
      paymentMethod: "personal",
    }, jar);
    const draftItemId = draftItem.data?.itemId;
    check("Created draft item", !!draftItemId, `data: ${JSON.stringify(draftItem.data)}`);

    if (draftItemId) {
      const delRes = await req("DELETE", `/api/v1/expenses/items/${draftItemId}`, null, jar);
      check("Delete item from draft returns 200", delRes.status === 200,
        `got ${delRes.status} — ${JSON.stringify(delRes.data)}`);
    }
  } else {
    check("Created draft report for item delete", false);
  }
}

// ── TEST 18: Cannot delete item from submitted report ─────────────────────────
console.log("\nTEST 18: Cannot delete item from submitted report");
if (itemId) {
  const delLocked = await req("DELETE", `/api/v1/expenses/items/${itemId}`, null, jar);
  check("Delete item from non-draft returns 409", delLocked.status === 409,
    `got ${delLocked.status} — ${JSON.stringify(delLocked.data)}`);
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════");
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
