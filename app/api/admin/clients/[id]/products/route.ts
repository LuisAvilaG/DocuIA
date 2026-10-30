import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { organizations, orgProducts } from "@/db/schema";
import { PRODUCTS, type ProductKey } from "@/lib/products/registry";
import { PRESETS, seedContractPreset } from "@/lib/contracts/presets";
import { getContractConfig } from "@/lib/contracts/config";

type Params = { params: Promise<{ id: string }> };

const KEYS = PRODUCTS.map((p) => p.key) as [ProductKey, ...ProductKey[]];

const putSchema = z.object({
  products: z.array(z.object({
    key:    z.enum(KEYS),
    status: z.enum(["active", "trial", "disabled"]),
    config: z.object({
      maxFlows: z.number().int().min(1).max(50).optional(),
      playbook: z.string().max(60).optional(),
    }).partial().optional(),
  })).min(1),
});

async function handleGET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;
  const rows = await db.query.orgProducts.findMany({ where: eq(orgProducts.organizationId, id) });
  const byKey = new Map(rows.map((r) => [r.productKey, r]));
  return NextResponse.json({
    products: PRODUCTS.map((p) => {
      const row = byKey.get(p.key);
      return { key: p.key, name: p.name, description: p.description, requiresIntegration: p.requiresIntegration,
        status: row?.status ?? "disabled", config: (row?.configJson as Record<string, unknown> | null) ?? null, enabledAt: row?.enabledAt ?? null, contracted: Boolean(row) };
    }),
    playbooks: Object.values(PRESETS).map((p) => ({ key: p.key, name: p.name })),
  });
}

/** Sets the whole product list of a client (à la carte). */
async function handlePUT(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id), columns: { id: true, name: true } });
  if (!org) return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 });
  if (!parsed.data.products.some((p) => p.status !== "disabled")) {
    return NextResponse.json({ error: "El cliente debe conservar al menos un producto activo" }, { status: 400 });
  }

  const existing = await db.query.orgProducts.findMany({ where: eq(orgProducts.organizationId, id) });
  const existingBy = new Map(existing.map((r) => [r.productKey, r]));
  const summary: string[] = [];
  const now = new Date();

  for (const p of parsed.data.products) {
    const current = existingBy.get(p.key);
    const prevConfig = (current?.configJson as Record<string, unknown> | null) ?? {};
    const config: Record<string, unknown> = { ...prevConfig };
    if (p.key === "contract_intelligence") {
      if (p.config?.maxFlows) config.maxFlows = p.config.maxFlows;
      if (p.config?.playbook) config.playbook = p.config.playbook;
    }
    if (!current) {
      if (p.status === "disabled") continue;
      await db.insert(orgProducts).values({ organizationId: id, productKey: p.key, status: p.status, configJson: Object.keys(config).length ? config : null, enabledAt: now, updatedAt: now });
      summary.push(`${p.key}: contratado (${p.status})`);
    } else {
      const statusChanged = current.status !== p.status;
      const configChanged = JSON.stringify(prevConfig) !== JSON.stringify(config);
      if (!statusChanged && !configChanged) continue;
      await db.update(orgProducts)
        .set({ status: p.status, configJson: Object.keys(config).length ? config : null, updatedAt: now, ...(statusChanged && p.status !== "disabled" && current.status === "disabled" ? { enabledAt: now } : {}) })
        .where(and(eq(orgProducts.organizationId, id), eq(orgProducts.productKey, p.key)));
      if (statusChanged) summary.push(`${p.key}: ${current.status} → ${p.status}`);
      if (configChanged) summary.push(`${p.key}: configuración`);
    }
    // First activation of contracts: seed the playbook so the client has a
    // working configuration from day one (never overwrites an existing one).
    if (p.key === "contract_intelligence" && p.status !== "disabled") {
      const cfg = await getContractConfig(id).catch(() => null);
      if (!cfg || cfg.docTypes.length === 0) {
        await seedContractPreset(id, typeof config.playbook === "string" ? config.playbook : undefined).catch((e) => console.error("[products] seed preset", e));
      }
    }
  }

  if (summary.length) {
    await logAdminAction(req, session!, { action: "products.updated", targetOrgId: id, targetOrgName: org.name, after: { summary: summary.join("; ") } });
  }
  return NextResponse.json({ ok: true, changed: summary });
}

export const GET = withApiSecurity(handleGET);
export const PUT = withApiSecurity(handlePUT);
