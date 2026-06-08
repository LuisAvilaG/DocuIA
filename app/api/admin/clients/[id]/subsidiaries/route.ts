import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { subsidiaries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const rows = await db.query.subsidiaries.findMany({
      where: eq(subsidiaries.organizationId, organizationId),
    });
    return NextResponse.json({ subsidiaries: rows });
  } catch (err) {
    console.error("[clients/subsidiaries GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();

    // body.subsidiaries: Array<{ nsSubsidiaryId, name, currency?, locale? }>
    const incoming: Array<{ nsSubsidiaryId: string; name: string; currency?: string; locale?: string }> =
      body.subsidiaries ?? [];

    if (!incoming.length) {
      return NextResponse.json({ error: "At least one subsidiary is required" }, { status: 400 });
    }

    const existing = await db.query.subsidiaries.findMany({
      where: eq(subsidiaries.organizationId, organizationId),
    });
    const existingByNsId = new Map(existing.map((s) => [s.nsSubsidiaryId, s]));

    const now = new Date();
    const upserted: string[] = [];

    for (const sub of incoming) {
      if (!sub.nsSubsidiaryId || !sub.name) continue;

      const existingRow = existingByNsId.get(sub.nsSubsidiaryId);
      if (existingRow) {
        await db.update(subsidiaries)
          .set({ name: sub.name, currency: sub.currency ?? existingRow.currency, updatedAt: now })
          .where(eq(subsidiaries.id, existingRow.id));
        upserted.push(existingRow.id);
      } else {
        const id = randomUUID();
        await db.insert(subsidiaries).values({
          id,
          organizationId,
          name: sub.name,
          nsSubsidiaryId: sub.nsSubsidiaryId,
          currency: sub.currency ?? "USD",
          locale: sub.locale ?? "en-US",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        upserted.push(id);
      }
    }

    return NextResponse.json({ ok: true, count: upserted.length });
  } catch (err) {
    console.error("[clients/subsidiaries POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
