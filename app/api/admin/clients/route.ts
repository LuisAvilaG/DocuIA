import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { organizations, subscriptions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays } from "date-fns";

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

    return NextResponse.json({ ok: true, organizationId: orgId }, { status: 201 });
  } catch (err) {
    console.error("[admin/clients POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
