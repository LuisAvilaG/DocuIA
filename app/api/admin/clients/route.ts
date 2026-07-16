import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { organizations, subscriptions, orgProducts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays } from "date-fns";
import { PRODUCTS, type ProductKey } from "@/lib/products/registry";
import { seedContractPreset } from "@/lib/contracts/presets";

const VALID_PRODUCTS = new Set(PRODUCTS.map((p) => p.key));

export async function GET() {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const orgs = await db.query.organizations.findMany({
      orderBy: [desc(organizations.createdAt)],
      with: { nsConnections: true, subscription: true },
    });
    return NextResponse.json({ organizations: orgs });
  } catch (err) {
    console.error("[admin/clients GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const body = await req.json();
    const { name, slug, timezone, billingEmail } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
    }

    // Product-first onboarding: the client is created with one or more products.
    // Default to ap_automation for backward compatibility if none are sent.
    const rawProducts: string[] = Array.isArray(body.products) ? body.products : [];
    const selectedProducts = rawProducts.filter((p) => VALID_PRODUCTS.has(p as ProductKey));
    if (rawProducts.length > 0 && selectedProducts.length === 0) {
      return NextResponse.json({ error: "Producto(s) inválido(s)" }, { status: 400 });
    }
    const productsToProvision = selectedProducts.length > 0 ? selectedProducts : ["ap_automation"];

    const existing = await db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    });
    if (existing) {
      return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
    }

    const orgId = randomUUID();
    const now = new Date();

    await db.insert(organizations).values({
      id: orgId,
      name,
      slug,
      status: "trial",
      timezone: timezone ?? "America/Mexico_City",
      billingEmail: billingEmail ?? null,
      trialEndsAt: addDays(now, 30),
      activeNsEnvironment: "sandbox",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(subscriptions).values({
      id: randomUUID(),
      organizationId: orgId,
      planId: "starter",
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, 30),
      trialEnd: addDays(now, 30),
    });

    // Per-client flow quota for Contract Intelligence (superadmin-set).
    const rawMax = Number(body.contractMaxFlows);
    const maxFlows = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : undefined;

    // Provision the selected products (à la carte). Activating a product makes
    // its default-enabled features light up via the feature guard.
    await db.insert(orgProducts).values(
      productsToProvision.map((productKey) => ({
        organizationId: orgId,
        productKey,
        status: "active" as const,
        configJson: productKey === "contract_intelligence" && maxFlows ? { maxFlows } : null,
      })),
    ).onConflictDoNothing({ target: [orgProducts.organizationId, orgProducts.productKey] });

    // Contracts: seed a playbook preset so the client has a working config from
    // day one (doc types, fields, validation rules, output template). Editable later.
    if (productsToProvision.includes("contract_intelligence")) {
      const playbook = typeof body.contractPlaybook === "string" ? body.contractPlaybook : undefined;
      await seedContractPreset(orgId, playbook).catch((e) => console.error("[seedContractPreset]", e));
    }

    return NextResponse.json({ ok: true, organizationId: orgId, products: productsToProvision }, { status: 201 });
  } catch (err) {
    console.error("[admin/clients POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
