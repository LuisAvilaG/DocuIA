/**
 * Quick UI page smoke test — verifies pages load (200) with valid session
 */
const BASE = "http://localhost:3000";

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

async function get(path, jar) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: jar.header() },
    redirect: "manual",
  });
  if (jar) { const sc = res.headers.get("set-cookie"); if (sc) jar.update(sc); }
  return res;
}

let ok = 0, fail = 0;
function check(label, cond, detail = "") {
  if (cond) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); fail++; }
}

console.log("\n══ UI Smoke Test ══\n");

// Login
const jar = new CookieJar();
const lr = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "carlos@acme.mx", password: "Demo1234!" }),
  redirect: "manual",
});
jar.update(lr.headers.get("set-cookie"));
check("Login (200)", lr.status === 200);

// UI pages — 200 = rendered, 307 = redirect (would mean auth failed in page)
const pages = [
  ["/expenses",              "Expenses list page"],
  ["/expenses/new",          "New expense page"],
  ["/accounting/expenses",   "Accounting expenses page"],
  ["/statistics",            "Statistics page"],
  ["/dashboard",             "Dashboard"],
];

for (const [path, label] of pages) {
  const r = await get(path, jar);
  check(`${label} (${r.status})`, r.status === 200, `status: ${r.status}, location: ${r.headers.get("location") ?? "none"}`);
}

console.log(`\n══ RESULTS: ${ok} passed, ${fail} failed ══\n`);
if (fail > 0) process.exit(1);
