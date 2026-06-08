import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { subsidiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string; subId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, subId } = await params;
    const body = await req.json();

    const sub = await db.query.subsidiaries.findFirst({
      where: and(
        eq(subsidiaries.id, subId),
        eq(subsidiaries.organizationId, organizationId),
      ),
    });
    if (!sub) return NextResponse.json({ error: "Subsidiary not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.nsSubsidiaryId === "string" && body.nsSubsidiaryId.trim()) {
      updates.nsSubsidiaryId = body.nsSubsidiaryId.trim();
    }
    if (typeof body.currency === "string" && body.currency.trim()) {
      updates.currency = body.currency.trim().toUpperCase();
    }
    if (typeof body.locale === "string") {
      updates.locale = body.locale.trim() || null;
    }
    if (typeof body.isActive === "boolean") {
      updates.isActive = body.isActive;
    }

    await db.update(subsidiaries).set(updates).where(eq(subsidiaries.id, subId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clients/subsidiaries PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, subId } = await params;

    const sub = await db.query.subsidiaries.findFirst({
      where: and(
        eq(subsidiaries.id, subId),
        eq(subsidiaries.organizationId, organizationId),
      ),
    });
    if (!sub) return NextResponse.json({ error: "Subsidiary not found" }, { status: 404 });

    await db.delete(subsidiaries).where(eq(subsidiaries.id, subId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clients/subsidiaries DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
