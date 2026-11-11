import { withApiSecurity } from "@/lib/security/http";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";

/** Personas que pueden aprobar casos (administradores y aprobadores activos), para la etapa Aprobación del flujo. */
async function handleGET() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const users = await db.query.orgUsers.findMany({
    where: and(eq(orgUsers.organizationId, session.orgId), eq(orgUsers.isActive, true), inArray(orgUsers.role, ["admin", "approver"])),
    columns: { id: true, fullName: true, email: true, role: true },
  });
  return NextResponse.json({ users: users.map((u) => ({ id: u.id, name: u.fullName || u.email, role: u.role })) });
}

export const GET = withApiSecurity(handleGET);
