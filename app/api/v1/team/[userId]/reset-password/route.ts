import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";

type Params = { params: Promise<{ userId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  const { userId } = await params;

  const user = await db.query.orgUsers.findFirst({
    where: and(eq(orgUsers.id, userId), eq(orgUsers.organizationId, session.orgId)),
    columns: { id: true, email: true, role: true },
  });

  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const tempPassword = randomUUID().slice(0, 12);
  await db.update(orgUsers)
    .set({ passwordHash: hashSync(tempPassword, 12), updatedAt: new Date() })
    .where(eq(orgUsers.id, userId));

  return NextResponse.json({ ok: true, tempPassword });
}
