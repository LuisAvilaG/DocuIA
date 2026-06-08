import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  const rows = await db
    .select({
      id:          orgUsers.id,
      email:       orgUsers.email,
      fullName:    orgUsers.fullName,
      lastLoginAt: orgUsers.lastLoginAt,
    })
    .from(orgUsers)
    .where(and(
      eq(orgUsers.organizationId, session.orgId),
      eq(orgUsers.role, "expense_submitter"),
      eq(orgUsers.isActive, true),
    ))
    .orderBy(orgUsers.fullName);

  return NextResponse.json(rows.map(r => ({
    id:          r.id,
    email:       r.email,
    fullName:    r.fullName,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
  })));
}
