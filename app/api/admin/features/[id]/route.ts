import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { features } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id } = await params;
  try {
    const body = await req.json() as { defaultEnabled?: boolean };
    if (typeof body.defaultEnabled !== "boolean") {
      return NextResponse.json({ error: "defaultEnabled requerido" }, { status: 400 });
    }
    await db.update(features).set({ defaultEnabled: body.defaultEnabled }).where(eq(features.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/features PATCH]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
