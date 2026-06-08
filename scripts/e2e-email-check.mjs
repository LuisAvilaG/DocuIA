/**
 * Quick test to confirm submit sends email log to console
 * (no RESEND_API_KEY in dev = console.log fallback)
 */
const BASE = "http://localhost:3000";

class CookieJar {
  constructor() { this.cookies = {}; }
  update(h) {
    if (!h) return;
    const [pair] = h.split(";");
    const idx = pair.indexOf("=");
    if (idx >= 0) this.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function api(method, path, body, jar) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.update(sc);
  return { status: res.status, data: await res.json().catch(() => null) };
}

const jar = new CookieJar();
await api("POST", "/api/v1/auth/login", { email: "carlos@acme.mx", password: "Demo1234!" }, jar);

// Create report + item + submit
const { data: r } = await api("POST", "/api/v1/expenses/reports", { purpose: "Email test" }, jar);
const reportId = r?.reportId;
await api("POST", "/api/v1/expenses/items", {
  reportId, vendorName: "Test", total: 50000, subtotal: 42017, taxAmount: 7983,
  currency: "COP", paymentMethod: "personal",
}, jar);

console.log("\n▶ Submitting report — watch for [email:dev] line in server console...\n");
const { status } = await api("POST", `/api/v1/expenses/reports/${reportId}/submit`, {}, jar);
console.log(`Submit status: ${status}`);
console.log("\n✅ Check server terminal for:\n  [email:dev] To: carlos@acme.mx\n  Subject: Informe de gastos pendiente de revisión\n");
