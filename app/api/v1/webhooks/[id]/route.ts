import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { webhooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const body = await req.json() as { isActive?: unknown; events?: unknown };
    const updates: Record<string, unknown> = {};

    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    if (Array.isArray(body.events))          updates.events  = body.events;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    }

    await db.update(webhooks).set(updates)
      .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, session.orgId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhooks PATCH]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await db.delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, session.orgId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhooks DELETE]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
