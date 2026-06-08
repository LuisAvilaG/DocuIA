import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { exceptionQueue } from "@/db/schema";
import { eq, and } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { id } = await params;
    const exceptionId = Number(id);
    if (!Number.isFinite(exceptionId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const notes = String(body.notes || "").slice(0, 1000);

    const exception = await db.query.exceptionQueue.findFirst({
      where: and(
        eq(exceptionQueue.id, exceptionId),
        eq(exceptionQueue.organizationId, session.orgId)
      ),
    });

    if (!exception) {
      return NextResponse.json({ error: "Excepción no encontrada" }, { status: 404 });
    }
    if (exception.status === "resolved" || exception.status === "dismissed") {
      return NextResponse.json({ error: "Esta excepción ya fue resuelta" }, { status: 409 });
    }

    await db.update(exceptionQueue)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: session.sub,
        resolutionNotes: notes || "Resuelta manualmente",
        updatedAt: new Date(),
      })
      .where(eq(exceptionQueue.id, exceptionId));

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[exceptions/resolve]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
