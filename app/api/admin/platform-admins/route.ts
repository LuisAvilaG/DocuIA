import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { randomUUID } from "crypto";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function safeAdmin(admin: typeof platformAdmins.$inferSelect) {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    isActive: admin.isActive,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

export async function GET() {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const admins = await db
      .select()
      .from(platformAdmins)
      .orderBy(desc(platformAdmins.createdAt));

    return NextResponse.json({
      currentAdminId: session!.sub,
      admins: admins.map(safeAdmin),
    });
  } catch (err) {
    console.error("[platform-admins GET]", err);
    return NextResponse.json({ error: "No se pudieron cargar los administradores" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const { email: rawEmail, fullName: rawFullName, password } = body as Record<string, unknown>;
    const email = normalizeEmail(rawEmail);
    const fullName = typeof rawFullName === "string" ? rawFullName.trim().slice(0, 255) || null : null;

    if (!email) {
      return NextResponse.json({ error: "Ingresa un email válido" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 12) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres" }, { status: 400 });
    }

    const existing = await db.query.platformAdmins.findFirst({
      where: eq(platformAdmins.email, email),
      columns: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Ya existe un administrador con ese email" }, { status: 409 });
    }

    const [admin] = await db
      .insert(platformAdmins)
      .values({
        id: randomUUID(),
        email,
        fullName,
        passwordHash: hashSync(password, 12),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ admin: safeAdmin(admin) }, { status: 201 });
  } catch (err) {
    console.error("[platform-admins POST]", err);
    return NextResponse.json({ error: "No se pudo crear el administrador" }, { status: 500 });
  }
}
