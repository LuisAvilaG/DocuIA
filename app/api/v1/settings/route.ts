import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden modificar la configuración" }, { status: 403 });
  }

  try {
    const body = await req.json() as {
      autoProcessThreshold?: unknown;
      timezone?: unknown;
      billingEmail?: unknown;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.autoProcessThreshold !== undefined) {
      const v = body.autoProcessThreshold;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 1) {
        return NextResponse.json({ error: "El umbral debe ser un número entre 0.50 y 1.00" }, { status: 400 });
      }
      updates.autoProcessThreshold = v;
    }

    if (body.timezone !== undefined) {
      const v = body.timezone;
      if (typeof v !== "string" || v.length === 0 || v.length > 60) {
        return NextResponse.json({ error: "Zona horaria inválida" }, { status: 400 });
      }
      updates.timezone = v.trim();
    }

    if (body.billingEmail !== undefined) {
      const v = body.billingEmail;
      if (v === null || v === "") {
        updates.billingEmail = null;
      } else if (typeof v === "string" && v.includes("@")) {
        updates.billingEmail = v.toLowerCase().trim();
      } else {
        return NextResponse.json({ error: "Email de facturación inválido" }, { status: 400 });
      }
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
    }

    await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, session.orgId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[settings/patch]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
