import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { webhooks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";

const MAX_WEBHOOKS = 10;
const VALID_EVENTS = new Set(["completed", "review", "failed"]);

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const rows = await db.query.webhooks.findMany({
      where: eq(webhooks.organizationId, session.orgId),
      columns: { secret: false },
    });
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[webhooks GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden crear webhooks" }, { status: 403 });
  }

  try {
    const existing = await db.query.webhooks.findMany({
      where: eq(webhooks.organizationId, session.orgId),
      columns: { id: true },
    });
    if (existing.length >= MAX_WEBHOOKS) {
      return NextResponse.json({ error: `Máximo ${MAX_WEBHOOKS} webhooks por organización` }, { status: 400 });
    }

    const body = await req.json() as { url?: unknown; events?: unknown };

    if (typeof body.url !== "string" || !body.url.startsWith("https://")) {
      return NextResponse.json({ error: "La URL debe comenzar con https://" }, { status: 400 });
    }
    if (body.url.length > 500) {
      return NextResponse.json({ error: "URL demasiado larga" }, { status: 400 });
    }

    const events = Array.isArray(body.events) ? body.events : ["completed", "review", "failed"];
    if (!events.every((e: unknown) => typeof e === "string" && VALID_EVENTS.has(e))) {
      return NextResponse.json({ error: "Eventos inválidos. Usa: completed, review, failed" }, { status: 400 });
    }

    const secret = randomBytes(32).toString("hex");

    const [row] = await db.insert(webhooks).values({
      organizationId: session.orgId,
      url:            body.url,
      secret,
      events:         events as string[],
    }).returning();

    return NextResponse.json({ ...row, secret }, { status: 201 });
  } catch (err) {
    console.error("[webhooks POST]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
