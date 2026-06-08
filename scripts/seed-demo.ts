/**
 * Seed demo data — organizations, users, subscriptions, usage, features, subsidiaries.
 * Run: npx tsx scripts/seed-demo.ts
 * Safe to re-run: skips if data already exists (idempotent by slug).
 */
import "dotenv/config";
import { db } from "@/lib/db";
import {
  organizations, orgUsers, subscriptions, usageDaily,
  onboardingProgress, orgFeatures, subsidiaries,
  subsidiaryDocumentConfigs, plans,
} from "@/db/schema";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { subDays, format } from "date-fns";

// ── Helpers ───────────────────────────────────────────────────
const uid = () => randomUUID();
const today = new Date();
const dateStr = (d: Date) => format(d, "yyyy-MM-dd");
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

// ── Plans seed (idempotent) ───────────────────────────────────
async function seedPlans() {
  const existing = await db.query.plans.findFirst();
  if (existing) return;

  await db.insert(plans).values([
    {
      id: "starter",
      name: "Starter",
      description: "Para equipos pequeños",
      priceMonthly: "500.00",
      priceYearly: "5000.00",
      docsLimit: 100,
      usersLimit: 2,
      subsidiariesLimit: 1,
      overagePerDoc: "0.60",
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "growth",
      name: "Growth",
      description: "Para empresas con volumen moderado",
      priceMonthly: "1500.00",
      priceYearly: "15000.00",
      docsLimit: 500,
      usersLimit: 5,
      subsidiariesLimit: 3,
      overagePerDoc: "0.50",
      isActive: true,
      sortOrder: 2,
    },
    {
      id: "enterprise",
      name: "Enterprise",
      description: "Para operaciones grandes",
      priceMonthly: "3500.00",
      priceYearly: "35000.00",
      docsLimit: -1,
      usersLimit: -1,
      subsidiariesLimit: -1,
      overagePerDoc: "0.40",
      isActive: true,
      sortOrder: 3,
    },
  ]);
  console.log("  ✓ Plans seeded");
}

// ── Org definitions ───────────────────────────────────────────
const ORGS = [
  {
    slug: "distribuidora-acme",
    name: "Distribuidora Acme",
    plan: "enterprise",
    status: "active" as const,
    healthScore: 92,
    completedSteps: 8,
    timezone: "America/Mexico_City",
    docsPerDay: { min: 150, max: 220 },
    users: [
      { email: "carlos@acme.mx",    fullName: "Carlos Mendoza", role: "admin"    as const },
      { email: "maria@acme.mx",     fullName: "María López",    role: "operator" as const },
      { email: "roberto@acme.mx",   fullName: "Roberto Silva",  role: "viewer"   as const },
    ],
    features: [
      { featureId: "auto_mapping",       isEnabled: true,  config: { min_confirmations: 3, merge_similarity: 0.90, suggest_similarity: 0.80, vendor_suggest_similarity: 0.88 }, notes: "Reducido a 3 confirmaciones por volumen alto" },
      { featureId: "ai_tiered_fallback", isEnabled: true,  config: { soft_fallback_rate: 0.05, complex_line_count_threshold: 15 }, notes: null },
      { featureId: "approval_workflow",  isEnabled: true,  config: {}, notes: "Requerido por controles internos" },
      { featureId: "bulk_upload",        isEnabled: true,  config: {}, notes: null },
      { featureId: "duplicate_detection",isEnabled: true,  config: {}, notes: null },
      { featureId: "advanced_analytics", isEnabled: true,  config: {}, notes: null },
      { featureId: "white_label",        isEnabled: false, config: {}, notes: "Rechazaron el branding personalizado" },
      { featureId: "webhook_system",     isEnabled: true,  config: {}, notes: null },
    ],
    subsidiaries: [
      { name: "USA Operations",  nsSubsidiaryId: "58", currency: "USD", locale: "en-US", docTypes: ["invoice", "purchase_order"] },
      { name: "México CFDI",     nsSubsidiaryId: "7",  currency: "MXN", locale: "es-MX", docTypes: ["xml_cfdi"] },
    ],
  },
  {
    slug: "logistech-mx",
    name: "LogisTech MX",
    plan: "growth",
    status: "active" as const,
    healthScore: 78,
    completedSteps: 7,
    timezone: "America/Monterrey",
    docsPerDay: { min: 40, max: 65 },
    users: [
      { email: "ana@logistech.mx",  fullName: "Ana Gutiérrez", role: "admin"    as const },
      { email: "pedro@logistech.mx",fullName: "Pedro Ramos",   role: "operator" as const },
    ],
    features: [
      { featureId: "auto_mapping",        isEnabled: true, config: {}, notes: null },
      { featureId: "duplicate_detection", isEnabled: true, config: {}, notes: "Tuvieron un pago doble en marzo" },
      { featureId: "webhook_system",      isEnabled: true, config: {}, notes: "Integrado con Slack" },
      { featureId: "exception_queue",     isEnabled: true, config: {}, notes: null },
    ],
    subsidiaries: [
      { name: "Monterrey HQ", nsSubsidiaryId: "12", currency: "MXN", locale: "es-MX", docTypes: ["invoice", "purchase_order"] },
    ],
  },
  {
    slug: "ferreteria-central",
    name: "Ferretería Central SA",
    plan: "starter",
    status: "trial" as const,
    healthScore: 45,
    completedSteps: 4,
    timezone: "America/Mexico_City",
    docsPerDay: { min: 3, max: 12 },
    users: [
      { email: "luis@ferreteria.mx", fullName: "Luis Herrera", role: "admin" as const },
    ],
    features: [
      { featureId: "auto_mapping", isEnabled: false, config: {}, notes: "En evaluación, aún no confirman suficientes mapeos" },
    ],
    subsidiaries: [
      { name: "CDMX", nsSubsidiaryId: "23", currency: "MXN", locale: "es-MX", docTypes: ["invoice"] },
    ],
  },
  {
    slug: "industrial-norte",
    name: "Industrial Norte SA",
    plan: "growth",
    status: "suspended" as const,
    healthScore: 12,
    completedSteps: 3,
    timezone: "America/Chihuahua",
    docsPerDay: { min: 0, max: 0 },
    users: [
      { email: "jose@industrial-norte.mx", fullName: "José Fuentes", role: "admin" as const },
    ],
    features: [],
    subsidiaries: [],
  },
  {
    slug: "comercial-pacifico",
    name: "Comercial Pacífico",
    plan: "starter",
    status: "active" as const,
    healthScore: 65,
    completedSteps: 6,
    timezone: "America/Mazatlan",
    docsPerDay: { min: 18, max: 35 },
    users: [
      { email: "sofia@comercial-pacifico.mx", fullName: "Sofía Morales", role: "admin"    as const },
      { email: "daniel@comercial-pacifico.mx",fullName: "Daniel Torres", role: "operator" as const },
    ],
    features: [
      { featureId: "auto_mapping",   isEnabled: true, config: { min_confirmations: 7 }, notes: null },
      { featureId: "data_export",    isEnabled: true, config: {}, notes: null },
    ],
    subsidiaries: [
      { name: "Sinaloa", nsSubsidiaryId: "31", currency: "MXN", locale: "es-MX", docTypes: ["invoice", "purchase_order"] },
    ],
  },
  {
    slug: "drt-mexico",
    name: "DRT México",
    plan: "enterprise",
    status: "active" as const,
    healthScore: 98,
    completedSteps: 8,
    timezone: "America/Mexico_City",
    docsPerDay: { min: 200, max: 320 },
    users: [
      { email: "admin@drt.mx",     fullName: "Admin DRT",       role: "admin"    as const },
      { email: "ops1@drt.mx",      fullName: "Operador 1",      role: "operator" as const },
      { email: "ops2@drt.mx",      fullName: "Operador 2",      role: "operator" as const },
      { email: "reportes@drt.mx",  fullName: "Analista Reporte",role: "viewer"   as const },
    ],
    features: [
      { featureId: "auto_mapping",         isEnabled: true,  config: { min_confirmations: 2, merge_similarity: 0.95 }, notes: "Config agresiva por volumen" },
      { featureId: "ai_tiered_fallback",   isEnabled: true,  config: { soft_fallback_rate: 0.10, complex_line_count_threshold: 10 }, notes: null },
      { featureId: "ai_force_secondary",   isEnabled: false, config: {}, notes: "Solo en casos especiales" },
      { featureId: "bulk_upload",          isEnabled: true,  config: {}, notes: null },
      { featureId: "duplicate_detection",  isEnabled: true,  config: {}, notes: null },
      { featureId: "approval_workflow",    isEnabled: false, config: {}, notes: "No requieren aprobación, confían en AI" },
      { featureId: "exception_queue",      isEnabled: true,  config: {}, notes: null },
      { featureId: "webhook_system",       isEnabled: true,  config: {}, notes: "Conectado a su ERP interno" },
      { featureId: "advanced_analytics",   isEnabled: true,  config: {}, notes: null },
      { featureId: "tenant_audit_log",     isEnabled: true,  config: {}, notes: "Requerido por compliance" },
      { featureId: "white_label",          isEnabled: true,  config: { company_name: "DRT Platform", primary_color: "#1E3A8A", hide_branding: false }, notes: null },
    ],
    subsidiaries: [
      { name: "USA",            nsSubsidiaryId: "58", currency: "USD", locale: "en-US", docTypes: ["invoice", "purchase_order"] },
      { name: "México CFDI",    nsSubsidiaryId: "7",  currency: "MXN", locale: "es-MX", docTypes: ["xml_cfdi", "invoice"] },
      { name: "Colombia",       nsSubsidiaryId: "42", currency: "COP", locale: "es-CO", docTypes: ["invoice"] },
    ],
  },
];

// ── Main seed ─────────────────────────────────────────────────
async function main() {
  console.log("\n  DocuIA — Sembrando datos de ejemplo...\n");

  await seedPlans();

  for (const org of ORGS) {
    // Check if already seeded
    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.slug, org.slug),
    });
    if (existing) {
      console.log(`  ⟳  ${org.name} ya existe, se omite`);
      continue;
    }

    const orgId = uid();
    const now   = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // ── Organization ─────────────────────────────────────────
    await db.insert(organizations).values({
      id:         orgId,
      name:       org.name,
      slug:       org.slug,
      status:     org.status,
      billingEmail: org.users[0]?.email ?? null,
      timezone:   org.timezone,
      trialEndsAt: org.status === "trial" ? new Date(Date.now() + 5 * 86400000) : null,
    });

    // ── Subscription ─────────────────────────────────────────
    await db.insert(subscriptions).values({
      id:             uid(),
      organizationId: orgId,
      planId:         org.plan,
      status:         org.status === "active" || org.status === "trial" ? "active" : "canceled",
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
    });

    // ── Users ─────────────────────────────────────────────────
    for (const u of org.users) {
      await db.insert(orgUsers).values({
        id:             uid(),
        organizationId: orgId,
        email:          u.email,
        passwordHash:   hashSync("Demo1234!", 10),
        fullName:       u.fullName,
        role:           u.role,
        isActive:       true,
        emailVerified:  true,
      });
    }

    // ── Onboarding progress ───────────────────────────────────
    const steps = org.completedSteps;
    await db.insert(onboardingProgress).values({
      organizationId:       orgId,
      stepAccountCreated:   steps >= 1,
      stepEmailVerified:    steps >= 2,
      stepNsConfigured:     steps >= 3,
      stepFirstSync:        steps >= 4,
      stepFirstDoc:         steps >= 5,
      stepTeamInvited:      steps >= 6,
      stepMappings10:       steps >= 7,
      stepWebhookConfigured:steps >= 8,
      healthScore:          org.healthScore,
      totalSteps:           8,
      completedSteps:       steps,
      completedAt:          steps >= 8 ? subDays(now, rand(5, 30)) : null,
      lastEvaluatedAt:      now,
    });

    // ── Usage daily (last 30 days) ────────────────────────────
    if (org.docsPerDay.max > 0) {
      const dailyRows = Array.from({ length: 30 }, (_, i) => {
        const d      = subDays(today, 29 - i);
        const docs   = rand(org.docsPerDay.min, org.docsPerDay.max);
        const inv    = Math.floor(docs * 0.6);
        const po     = Math.floor(docs * 0.3);
        const xml    = docs - inv - po;
        const primary   = docs;
        const fallback  = Math.floor(docs * 0.1);
        const totalAmt  = docs * rand(800, 4500);
        return {
          organizationId: orgId,
          date:           dateStr(d),
          docsProcessed:  docs,
          docsInvoice:    inv,
          docsPo:         po,
          docsXml:        xml,
          aiPrimaryCalls: primary,
          aiFallbackCalls:fallback,
          aiTokensInput:  primary * rand(800, 1200),
          aiTokensOutput: primary * rand(200, 400),
          syncRuns:       rand(0, 3),
          apiCalls:       rand(0, 20),
          errors:         rand(0, Math.floor(docs * 0.02)),
          totalAmount:    String(totalAmt),
        };
      });

      for (const row of dailyRows) {
        await db.insert(usageDaily).values(row).onConflictDoNothing();
      }
    }

    // ── Feature overrides ─────────────────────────────────────
    for (const f of org.features) {
      await db.insert(orgFeatures).values({
        organizationId: orgId,
        featureId:      f.featureId,
        isEnabled:      f.isEnabled,
        configJson:     Object.keys(f.config).length > 0 ? f.config : null,
        notes:          f.notes,
      }).onConflictDoNothing();
    }

    // ── Subsidiaries ──────────────────────────────────────────
    for (const sub of org.subsidiaries) {
      const subId = uid();
      await db.insert(subsidiaries).values({
        id:             subId,
        organizationId: orgId,
        name:           sub.name,
        nsSubsidiaryId: sub.nsSubsidiaryId,
        currency:       sub.currency,
        locale:         sub.locale,
        isActive:       true,
      });

      for (const docType of sub.docTypes) {
        const engine =
          docType === "xml_cfdi"       ? "xml_cfdi_parser" :
          docType === "purchase_order" ? "gemini_tiered"   : "gemini_tiered";

        await db.insert(subsidiaryDocumentConfigs).values({
          subsidiaryId:     subId,
          documentType:     docType,
          extractionEngine: engine,
          isEnabled:        true,
          engineConfig:     null,
        }).onConflictDoNothing();
      }
    }

    console.log(`  ✓  ${org.name} (${org.plan}, ${org.status}, health: ${org.healthScore})`);
  }

  console.log("\n  ✓ Demo data completo.\n");
  console.log("  Organizaciones creadas:");
  ORGS.forEach(o => console.log(`    • ${o.name.padEnd(28)} ${o.plan.padEnd(12)} ${o.status}`));
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
