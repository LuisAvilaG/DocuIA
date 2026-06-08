import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptField, decryptField } from "@/lib/crypto/encrypt";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { aiApiKeyEncrypted: true },
  });

  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  return NextResponse.json({
    configured: !!org.aiApiKeyEncrypted,
    // Return masked key hint so UI can show "AIza...XYZ" without exposing full key
    keyHint: org.aiApiKeyEncrypted
      ? (() => {
          const plain = decryptField(org.aiApiKeyEncrypted!);
          return plain.length > 8
            ? `${plain.slice(0, 4)}${"•".repeat(plain.length - 8)}${plain.slice(-4)}`
            : "•".repeat(plain.length);
        })()
      : null,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;

  const body = await req.json();
  const { apiKey } = body as { apiKey?: string };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { id: true },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  if (apiKey === "" || apiKey === null) {
    // Clear the key
    await db.update(organizations)
      .set({ aiApiKeyEncrypted: null, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    return NextResponse.json({ ok: true, configured: false });
  }

  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
    return NextResponse.json({ error: "apiKey must be a valid string" }, { status: 400 });
  }

  const encrypted = encryptField(apiKey);
  await db.update(organizations)
    .set({ aiApiKeyEncrypted: encrypted, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));

  return NextResponse.json({ ok: true, configured: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const { id: organizationId } = await params;

  await db.update(organizations)
    .set({ aiApiKeyEncrypted: null, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));

  return NextResponse.json({ ok: true, configured: false });
}
