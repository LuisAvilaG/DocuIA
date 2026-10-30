import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { organizations, subscriptions, orgProducts, orgFeatures } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays } from "date-fns";
import { PRODUCTS, FEATURE_PRODUCT, type ProductKey } from "@/lib/products/registry";
import { FEATURE_CATALOG } from "@/lib/features/catalog";
import { PRESETS, seedContractPreset } from "@/lib/contracts/presets";
import { loadOrgFacts, healthFromFacts } from "@/lib/admin/health";

const KEYS = PRODUCTS.map((p) => p.key) as [ProductKey, ...ProductKey[]];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/;

const createSchema = z.object({
  name:             z.string().trim().min(2, "El nombre es requerido").max(255),
  slug:             z.string().trim().regex(SLUG, "Slug inválido: minúsculas, números y guiones"),
  timezone:         z.string().trim().min(1).max(60).default("America/Mexico_City"),
  billingEmail:     z.string().trim().toLowerCase().email().max(255).optional().nullable(),
  planId:           z.enum(["starter", "growth", "enterprise"]).default("starter"),
  products:         z.array(z.enum(KEYS)).min(1, "Selecciona al menos un producto"),
  contractMaxFlows: z.number().int().min(1).max(50).optional(),
  contractPlaybook: z.string().max(60).optional(),
  // Initial grants chosen in the wizard, featureId → on/off. Only the ones that
  // differ from the catalog default become org_features rows.
  features:         z.record(z.string(), z.boolean()).optional(),
});

export interface ClientListRow {
  id: string; name: string; slug: string; status: string; planId: string; products: string[];
  usage30: { docs: number; cases: number; reports: number }; users: number;
  health: { label: string; tone: "ok" | "warn" | "err" | "mute"; pending: string | null };
  trialEndsAt: string | null; lastActivityAt: string | null; activeNsEnvironment: string; suspensionReason: string | null; deletedAt: string | null;
}

async function handleGET(req: NextRequest) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const includeDeleted = req.nextUrl.searchParams.get("deleted") === "1";
    const facts = await loadOrgFacts();
    const rows: ClientListRow[] = [];
    for (const f of facts.values()) {
      if (f.deletedAt && !includeDeleted) continue;
      const health = healthFromFacts(f);
      rows.push({
        id: f.id, name: f.name, slug: f.slug, status: f.status, planId: f.planId,
        products: f.products.filter((p) => p.status !== "disabled").map((p) => p.key),
        usage30: f.usage30, users: f.users.total,
        health: { label: health.label, tone: health.tone, pending: health.pending?.label ?? null },
        trialEndsAt: f.trialEndsAt?.toISOString() ?? null, lastActivityAt: f.lastActivityAt?.toISOString() ?? null,
        activeNsEnvironment: f.activeNsEnvironment, suspensionReason: f.suspensionReason, deletedAt: f.deletedAt?.toISOString() ?? null,
      });
    }
    rows.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name));
    return NextResponse.json({ organizations: rows });
  } catch (err) {
    console.error("[admin/clients GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
    }
    const body = parsed.data;
    const products = [...new Set(body.products)];

    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, body.slug), columns: { id: true } });
    if (existing) return NextResponse.json({ error: "Ese slug ya está en uso" }, { status: 409 });

    const orgId = randomUUID();
    const now = new Date();
    const playbook = body.contractPlaybook && PRESETS[body.contractPlaybook] ? body.contractPlaybook : undefined;
    // Keep only known features whose product is contracted (or platform-wide)
    // and whose value differs from the default; the rest resolve from the catalog.
    const catalogBy = new Map<string, { defaultEnabled: boolean }>(FEATURE_CATALOG.map((f) => [f.id, f]));
    const grants = Object.entries(body.features ?? {}).filter(([id, on]) => {
      const f = catalogBy.get(id);
      if (!f || f.defaultEnabled === on) return false;
      const product = FEATURE_PRODUCT[id];
      return !product || products.includes(product);
    });

    await db.transaction(async (tx) => {
      await tx.insert(organizations).values({
        id: orgId, name: body.name, slug: body.slug, status: "trial", timezone: body.timezone,
        billingEmail: body.billingEmail ?? null, trialEndsAt: addDays(now, 30), activeNsEnvironment: "sandbox",
        createdAt: now, updatedAt: now,
      });
      await tx.insert(subscriptions).values({
        id: randomUUID(), organizationId: orgId, planId: body.planId, status: "trialing",
        currentPeriodStart: now, currentPeriodEnd: addDays(now, 30), trialEnd: addDays(now, 30),
      });
      // Provision the selected products (à la carte). Activating a product makes
      // its default-enabled features light up via the feature guard.
      await tx.insert(orgProducts).values(products.map((productKey) => ({
        organizationId: orgId, productKey, status: "active" as const,
        configJson: productKey === "contract_intelligence"
          ? { maxFlows: body.contractMaxFlows ?? 3, ...(playbook ? { playbook } : {}) }
          : null,
      }))).onConflictDoNothing({ target: [orgProducts.organizationId, orgProducts.productKey] });
      if (grants.length) {
        await tx.insert(orgFeatures).values(grants.map(([featureId, adminGranted]) => ({
          organizationId: orgId, featureId, adminGranted, isEnabled: false,
          enabledBy: session!.sub, notes: "Elegida en el alta",
        }))).onConflictDoNothing({ target: [orgFeatures.organizationId, orgFeatures.featureId] });
      }
    });

    // Contracts: seed a playbook preset so the client has a working config from
    // day one (doc types, fields, validation rules, output template).
    if (products.includes("contract_intelligence")) {
      await seedContractPreset(orgId, playbook).catch((e) => console.error("[seedContractPreset]", e));
    }

    await logAdminAction(req, session!, {
      action: "org.created", targetOrgId: orgId, targetOrgName: body.name,
      after: { slug: body.slug, products: products.join(", "), planId: body.planId, featuresAdjusted: grants.length },
    });

    return NextResponse.json({ ok: true, organizationId: orgId, products }, { status: 201 });
  } catch (err) {
    console.error("[admin/clients POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
