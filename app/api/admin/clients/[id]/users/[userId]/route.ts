import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId, userId } = await params;
    const body = await req.json();

    const user = await db.query.orgUsers.findFirst({
      where: and(
        eq(orgUsers.id, userId),
        eq(orgUsers.organizationId, organizationId),
      ),
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.role === "string" && ["admin", "operator", "viewer", "expense_submitter"].includes(body.role)) {
      updates.role = body.role;
    }
    if (typeof body.isActive === "boolean") {
      updates.isActive = body.isActive;
    }
    if (typeof body.fullName === "string") {
      updates.fullName = body.fullName || null;
    }
    if (typeof body.password === "string" && body.password.length >= 8) {
      updates.passwordHash = hashSync(body.password, 12);
    }

    await db.update(orgUsers).set(updates).where(eq(orgUsers.id, userId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clients/users PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
