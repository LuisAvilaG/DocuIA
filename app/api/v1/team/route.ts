import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { orgUsers, organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { randomUUID, randomBytes } from "crypto";
import { sendEmail, buildInviteEmail } from "@/lib/email/send";

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden invitar usuarios" }, { status: 403 });
  }

  try {
    const { email, fullName, role } = await req.json() as {
      email?: string;
      fullName?: string;
      role?: string;
    };

    if (!email) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();
    const safeRole   = (["admin", "operator", "viewer"] as const).includes(role as never)
      ? (role as "admin" | "operator" | "viewer")
      : "operator";

    // Email is globally unique across the platform.
    const existing = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, normalized),
      columns: { id: true },
    });

    if (existing) {
      return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }

    // Generate a readable temp password: xxxx-xxxx-xxxx
    const tempPassword = `${randomBytes(2).toString("hex")}-${randomBytes(2).toString("hex")}-${randomBytes(2).toString("hex")}`;
    const passwordHash = await hash(tempPassword, 12);
    const userId       = randomUUID();

    await db.insert(orgUsers).values({
      id:             userId,
      organizationId: session.orgId,
      email:          normalized,
      fullName:       fullName?.trim() || null,
      role:           safeRole,
      passwordHash,
      isActive:       true,
      emailVerified:  true,
      invitedBy:      session.sub,
      createdAt:      new Date(),
      updatedAt:      new Date(),
    });

    // Send invite email (logs to console if no RESEND_API_KEY)
    const org    = await db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    await sendEmail({
      to:      normalized,
      subject: `Invitación a DocuIA — ${org?.name ?? "tu organización"}`,
      html:    buildInviteEmail({
        fullName:     fullName?.trim() || normalized,
        orgName:      org?.name ?? "tu organización",
        email:        normalized,
        tempPassword,
        appUrl,
      }),
    });

    return NextResponse.json({ ok: true, userId, tempPassword }, { status: 201 });
  } catch (err) {
    console.error("[team/invite]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
