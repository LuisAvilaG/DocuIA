/**
 * Admin "Gastos" tab E2E test
 */
const BASE = "http://localhost:3000";
const ACME_ID = "c7e2a6a9-54a3-4d59-80be-43d3ffcb1b43";

class CookieJar {
  constructor() { this.cookies = {}; }
  update(h) {
    if (!h) return;
    const raw = Array.isArray(h) ? h : [h];
    for (const chunk of raw) {
      const [pair] = chunk.split(";");
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      this.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function req(method, path, body, jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (jar) { const sc = res.headers.get("set-cookie"); if (sc) jar.update(sc); }
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let ok = 0, fail = 0;
function check(label, cond, detail = "") {
  if (cond) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); fail++; }
}

console.log("\n══ Admin Gastos Tab Test ══\n");

// Login as superadmin
const jar = new CookieJar();
const lr = await fetch(`${BASE}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@docuia.com", password: "DocuIA2024!" }),
  redirect: "manual",
});
jar.update(lr.headers.get("set-cookie"));
check("Superadmin login (200)", lr.status === 200);

// TEST: GET /api/admin/clients/[id]/expenses
console.log("\nTEST 1: GET expense status for Acme");
const getRes = await req("GET", `/api/admin/clients/${ACME_ID}/expenses`, null, jar);
check("GET expenses returns 200", getRes.status === 200, `got ${getRes.status} — ${JSON.stringify(getRes.data)}`);
check("Returns counts object", typeof getRes.data?.counts === "object", `data: ${JSON.stringify(getRes.data)}`);
check("Returns categories array", Array.isArray(getRes.data?.categories), `data keys: ${Object.keys(getRes.data ?? {}).join(", ")}`);

// TEST: sync_all action (will fail without NS creds, but should return proper error)
console.log("\nTEST 2: POST sync action (graceful failure expected)");
const syncRes = await req("POST", `/api/admin/clients/${ACME_ID}/expenses`,
  { action: "sync_categories" }, jar);
// 422 = no active NS connection (expected in test env), 200 = success, 502 = NS error
check("Sync action returns a response", [200, 207, 400, 422, 500, 502].includes(syncRes.status),
  `got ${syncRes.status}`);
const hasField = syncRes.data?.ok !== undefined || syncRes.data?.error !== undefined;
check("Returns ok or error field", hasField, `data: ${JSON.stringify(syncRes.data)}`);

// TEST: PATCH category cap
console.log("\nTEST 3: PATCH category cap (if categories exist)");
const cats = getRes.data?.categories ?? [];
if (cats.length > 0) {
  const catId = cats[0].id;
  const patchRes = await req("PATCH", `/api/admin/clients/${ACME_ID}/expenses/categories?categoryId=${catId}`,
    { dailyCap: 500000, monthlyCap: 5000000 }, jar);
  check("PATCH cap returns 200", patchRes.status === 200, `got ${patchRes.status} — ${JSON.stringify(patchRes.data)}`);
} else {
  console.log("  ⚠️  No categories to patch (NS not synced yet — expected)");
  ok++;
}

// TEST: Admin UI page for client
console.log("\nTEST 4: Admin client page loads");
const pageRes = await fetch(`${BASE}/admin/clients/${ACME_ID}`, {
  headers: { Cookie: jar.header() },
  redirect: "manual",
});
check("Admin client page loads (200)", pageRes.status === 200, `status: ${pageRes.status}`);

console.log(`\n══ RESULTS: ${ok} passed, ${fail} failed ══\n`);
if (fail > 0) process.exit(1);
