import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'screenshots');
mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:3000';
const TENANT = { email: 'luisavi.g@hotmail.com', password: 'luis1997' };
const ADMIN  = { email: 'admin@docuia.com', password: 'DocuIA2024!' };

async function shot(page, name) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`✓  ${name}.png`);
}

async function loginTenant(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', TENANT.email);
  await page.fill('input[type="password"]', TENANT.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

async function loginAdmin(page) {
  await page.goto(`${BASE}/admin/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin', { timeout: 10000 });
}

async function clickTabIfExists(page, label) {
  try {
    const tab = page.getByRole('tab', { name: new RegExp(label, 'i') });
    if (await tab.isVisible({ timeout: 2000 })) {
      await tab.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {}
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // ── 1. Login screen ──────────────────────────────────────────────
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await shot(page, '01-login');

  // ── TENANT FLOW ──────────────────────────────────────────────────
  await loginTenant(page);

  // 2. Dashboard
  await page.goto(`${BASE}/dashboard`);
  await shot(page, '02-tenant-dashboard');

  // 3. Workflow vacío
  await page.goto(`${BASE}/workflow`);
  await shot(page, '03-workflow-empty');

  // 4. Historial
  await page.goto(`${BASE}/history`);
  await shot(page, '04-history-list');

  // 5. Detalle de primer documento (si existe)
  try {
    const firstLink = page.locator('table tbody tr').first().locator('a, [role="link"]').first();
    const href = await firstLink.getAttribute('href').catch(() => null);
    if (href) {
      await page.goto(`${BASE}${href}`);
      await shot(page, '05-history-detail');
    } else {
      // intentar ir directo por la fila
      await firstLink.click();
      await page.waitForLoadState('networkidle');
      await shot(page, '05-history-detail');
    }
  } catch {
    console.log('⚠  No hay documentos en historial, saltando detalle');
  }

  // 6. Excepciones
  await page.goto(`${BASE}/exceptions`);
  await shot(page, '06-exceptions');

  // 7. Mapeos
  await page.goto(`${BASE}/mappings`);
  await shot(page, '07-mappings');

  // 8. Estadísticas
  await page.goto(`${BASE}/statistics`);
  await shot(page, '08-statistics');

  // 9. Catálogos
  await page.goto(`${BASE}/catalogs`);
  await shot(page, '09-catalogs');

  // 10. Settings — tab General
  await page.goto(`${BASE}/settings`);
  await shot(page, '10-settings-general');

  // 11. Settings — tab Webhooks
  await clickTabIfExists(page, 'Webhook');
  await shot(page, '11-settings-webhooks');

  // 12. Settings — tab API Keys
  await page.goto(`${BASE}/settings`);
  await clickTabIfExists(page, 'API');
  await shot(page, '12-settings-apikeys');

  // 13. Settings — tab Auditoría
  await page.goto(`${BASE}/settings`);
  await clickTabIfExists(page, 'Audit');
  await shot(page, '13-settings-audit');

  // ── ADMIN FLOW ───────────────────────────────────────────────────
  await loginAdmin(page);

  // 14. Admin dashboard
  await page.goto(`${BASE}/admin`);
  await shot(page, '14-admin-dashboard');

  // 15. Listado de clientes
  await page.goto(`${BASE}/admin/clients`);
  await shot(page, '15-admin-clients');

  // 16. Detalle de primer cliente
  try {
    const firstClient = page.locator('table tbody tr, [data-client-row]').first();
    await firstClient.click();
    await page.waitForLoadState('networkidle');
    await shot(page, '16-admin-client-detail-general');

    // Tab NetSuite
    await clickTabIfExists(page, 'NetSuite');
    await shot(page, '17-admin-client-netsuite');

    // Tab Features
    await clickTabIfExists(page, 'Feature');
    await shot(page, '18-admin-client-features');
  } catch {
    console.log('⚠  No se pudo navegar al detalle de cliente');
  }

  // 19. Catálogo global de features
  await page.goto(`${BASE}/admin/features`);
  await shot(page, '19-admin-features-catalog');

  await browser.close();
  console.log(`\n✅  Todas las capturas guardadas en: screenshots/`);
})();
