import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const users = await db.query.orgUsers.findMany({
      where: eq(orgUsers.organizationId, organizationId),
    });
    return NextResponse.json({
      users: users.map((u) => ({ ...u, passwordHash: undefined })),
    });
  } catch (err) {
    console.error("[clients/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const { email, fullName, role, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    // Email is globally unique across the platform (not just per-org).
    const existing = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, email.toLowerCase().trim()),
      columns: { id: true },
    });

    if (existing) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email en la plataforma" }, { status: 409 });
    }

    const userId = randomUUID();
    await db.insert(orgUsers).values({
      id: userId,
      organizationId,
      email: email.toLowerCase().trim(),
      fullName: fullName ?? null,
      role: role ?? "admin",
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
