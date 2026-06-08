import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { features } from "@/db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const rows = await db.select().from(features).orderBy(asc(features.sortOrder), asc(features.name));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("[admin/features GET]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
