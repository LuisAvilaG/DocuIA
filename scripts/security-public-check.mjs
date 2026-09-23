// Read-only HTTP checks. No credential guessing, exploit payloads or state changes.
import fs from 'node:fs';
const base = new URL(process.argv[2]);
if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('Use HTTPS');
const paths = ['/', '/login', '/admin', '/dashboard', '/cases', '/api/admin/clients', '/api/admin/features', '/api/v1/contracts/cases', '/api/v1/settings', '/api/v1/expenses/reports', '/api/v1/documents/1/file', '/.env', '/.git/config'];
const results = [];
for (const path of paths) {
  const res = await fetch(new URL(path, base), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const row = { path, status: res.status, location: res.headers.get('location'), headers: Object.fromEntries(['content-type','content-security-policy','strict-transport-security','x-content-type-options','x-frame-options','cache-control','x-powered-by','access-control-allow-origin'].map(h=>[h,res.headers.get(h)])) };
  // Never print/store private response bodies, even if a guard is missing.
  await res.body?.cancel();
  results.push(row);
  console.log(path, res.status, row.location ?? '');
}
const artifact = { target: base.origin, checkedAt: new Date().toISOString(), mode: 'read-only anonymous HTTP', results };
fs.mkdirSync('output/security', { recursive: true });
fs.writeFileSync('output/security/public-check.json', JSON.stringify(artifact,null,2));
