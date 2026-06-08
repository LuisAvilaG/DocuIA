import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
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

    const existing = await db.query.orgUsers.findFirst({
      where: and(
        eq(orgUsers.organizationId, organizationId),
        eq(orgUsers.email, email.toLowerCase().trim()),
      ),
    });

    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists in this organization" }, { status: 409 });
    }

    const userId = randomUUID();
    await db.insert(orgUsers).values({
      id: userId,
      organizationId,
      email: email.toLowerCase().trim(),
      fullName: fullName ?? null,
      role: role ?? "admin",
      passwordHash: hashSync(password, 10),
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
