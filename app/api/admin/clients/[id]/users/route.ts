import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { orgUsers, organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";
import { emailSchema, passwordSchema } from "@/lib/auth/input";
import { isTenantRole } from "@/lib/auth/permissions";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    // Explicit columns: password, verification and reset tokens never leave the server.
    const users = await db.query.orgUsers.findMany({
      where: eq(orgUsers.organizationId, organizationId),
      columns: {
        id: true, organizationId: true, email: true, fullName: true, role: true, isActive: true,
        emailVerified: true, lastLoginAt: true, netsuiteEmployeeId: true, createdAt: true, updatedAt: true,
      },
    });
    return NextResponse.json({ users });
  } catch (err) {
    console.error("[clients/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json().catch(() => ({})) as { email?: unknown; fullName?: unknown; role?: unknown; password?: unknown };
    const parsedEmail = emailSchema.safeParse(body.email);
    if (!parsedEmail.success) return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    if (!passwordSchema.safeParse(body.password).success) {
      return NextResponse.json({ error: "La contraseña debe tener entre 8 y 72 caracteres" }, { status: 400 });
    }
    const role = body.role === undefined ? "admin" : body.role;
    if (!isTenantRole(role)) return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    const fullName = typeof body.fullName === "string" && body.fullName.trim() ? body.fullName.trim().slice(0, 255) : null;
    const email = parsedEmail.data;
    const password = body.password as string;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId), columns: { id: true } });
    if (!org) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

    // Email is globally unique across the platform (not just per-org).
    const existing = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, email),
      columns: { id: true },
    });

    if (existing) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email en la plataforma" }, { status: 409 });
    }

    const userId = randomUUID();
    await db.insert(orgUsers).values({
      id: userId,
      organizationId,
      email,
      fullName,
      role,
      passwordHash: hashSync(password, 12),
      isActive: true,
      emailVerified: true,
      invitedBy: session!.sub,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ ok: true, userId }, { status: 201 });
  } catch (err) {
    console.error("[clients/users POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
export const POST = withApiSecurity(handlePOST);
