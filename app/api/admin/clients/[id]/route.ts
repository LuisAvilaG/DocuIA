import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth/admin";
import { logAdminAction } from "@/lib/audit/admin";
import { db } from "@/lib/db";
import { organizations, subscriptions, authSessions } from "@/db/schema";
import { loadOneOrgFacts, healthFromFacts } from "@/lib/admin/health";
import { orgFootprint } from "@/lib/admin/purge-org";

type Params = { params: Promise<{ id: string }> };

const PLANS = ["starter", "growth", "enterprise"] as const;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,98}[a-z0-9])?$/;

const patchSchema = z.object({
  name:          z.string().trim().min(2).max(255).optional(),
  slug:          z.string().trim().regex(SLUG, "Slug inválido: minúsculas, números y guiones").optional(),
  timezone:      z.string().trim().min(1).max(60).optional(),
  billingEmail:  z.string().trim().toLowerCase().email().max(255).nullable().optional(),
  planId:        z.enum(PLANS).optional(),
  trialEndsAt:   z.string().datetime().nullable().optional(),
  // Lifecycle: activate (ends the trial), suspend with a reason, or restore.
  status:        z.enum(["active", "trial", "suspended"]).optional(),
  suspensionReason: z.string().trim().max(500).nullable().optional(),
}).strict();

async function handleGET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;
  const facts = await loadOneOrgFacts(id);
  if (!facts) return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 });
  const footprint = await orgFootprint(id);
  return NextResponse.json({ org: facts, health: healthFromFacts(facts), footprint });
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const body = parsed.data;

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
  if (!org) return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 });
  if (org.deletedAt) return NextResponse.json({ error: "La organización está marcada para eliminación" }, { status: 409 });

  if (body.slug && body.slug !== org.slug) {
    const taken = await db.query.organizations.findFirst({ where: eq(organizations.slug, body.slug), columns: { id: true } });
    if (taken) return NextResponse.json({ error: "Ese slug ya está en uso" }, { status: 409 });
  }

  const updates: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
  const changed: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  if (body.name !== undefined && body.name !== org.name) { updates.name = body.name; changed.name = body.name; before.name = org.name; }
  if (body.slug !== undefined && body.slug !== org.slug) { updates.slug = body.slug; changed.slug = body.slug; before.slug = org.slug; }
  if (body.timezone !== undefined && body.timezone !== org.timezone) { updates.timezone = body.timezone; changed.timezone = body.timezone; }
  if (body.billingEmail !== undefined && body.billingEmail !== org.billingEmail) { updates.billingEmail = body.billingEmail; changed.billingEmail = body.billingEmail; }
  if (body.trialEndsAt !== undefined) {
    updates.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
    changed.trialEndsAt = body.trialEndsAt;
  }

  let lifecycle: "org.suspended" | "org.restored" | "org.updated" | null = null;
  if (body.status && body.status !== org.status) {
    if (body.status === "suspended") {
      updates.status = "suspended";
      updates.suspensionReason = body.suspensionReason ?? null;
      lifecycle = "org.suspended";
    } else {
      updates.status = body.status;
      updates.suspensionReason = null;
      if (body.status === "active") updates.trialEndsAt = null;
      lifecycle = org.status === "suspended" ? "org.restored" : "org.updated";
    }
    changed.status = body.status;
    before.status = org.status;
  } else if (body.suspensionReason !== undefined && org.status === "suspended") {
    updates.suspensionReason = body.suspensionReason;
    changed.suspensionReason = body.suspensionReason;
  }

  let planChange: { from: string; to: string } | null = null;
  if (body.planId) {
    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, id) });
    if (!sub) {
      const now = new Date();
      await db.insert(subscriptions).values({
        id: crypto.randomUUID(), organizationId: id, planId: body.planId, status: org.status === "trial" ? "trialing" : "active",
        currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      });
      planChange = { from: "starter", to: body.planId };
    } else if (sub.planId !== body.planId) {
      await db.update(subscriptions).set({ planId: body.planId, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
      planChange = { from: sub.planId, to: body.planId };
    }
  }

  if (Object.keys(changed).length === 0 && !planChange) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }

  if (Object.keys(changed).length) {
    await db.update(organizations).set(updates).where(eq(organizations.id, id));
  }
  if (lifecycle === "org.suspended") {
    // Nobody from the org keeps a live session once access is suspended.
    await db.update(authSessions).set({ revokedAt: new Date() })
      .where(and(eq(authSessions.organizationId, id), eq(authSessions.userType, "org_user")));
  }

  if (planChange) {
    await logAdminAction(req, session!, { action: "org.plan_changed", targetOrgId: id, targetOrgName: org.name, before: { planId: planChange.from }, after: { planId: planChange.to } });
  }
  if (Object.keys(changed).length) {
    await logAdminAction(req, session!, {
      action: lifecycle ?? "org.updated", targetOrgId: id, targetOrgName: org.name, before,
      after: lifecycle === "org.suspended" ? { reason: body.suspensionReason ?? null } : changed,
    });
  }

  const facts = await loadOneOrgFacts(id);
  return NextResponse.json({ ok: true, org: facts, health: facts ? healthFromFacts(facts) : null });
}

// Soft delete: the org disappears from the panel, nobody can sign in, and
// the retention cron purges everything after 30 days. Requires the slug.
async function handleDELETE(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { confirm?: unknown };

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
  if (!org) return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 });
  if (org.deletedAt) return NextResponse.json({ error: "Ya está marcada para eliminación" }, { status: 409 });
  if (body.confirm !== org.slug) {
    return NextResponse.json({ error: "Escribe el slug de la organización para confirmar" }, { status: 400 });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ status: "churned", deletedAt: now, updatedAt: now }).where(eq(organizations.id, id));
    await tx.update(authSessions).set({ revokedAt: now })
      .where(and(eq(authSessions.organizationId, id), eq(authSessions.userType, "org_user")));
  });
  await logAdminAction(req, session!, { action: "org.deleted", targetOrgId: id, targetOrgName: org.name, after: { slug: org.slug } });
  return NextResponse.json({ ok: true, purgeAfter: new Date(now.getTime() + 30 * 86_400_000).toISOString() });
}

export const GET = withApiSecurity(handleGET);
export const PATCH = withApiSecurity(handlePATCH);
export const DELETE = withApiSecurity(handleDELETE);
