import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendEmail, buildResetEmail } from "@/lib/email/send";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json() as { email?: string };
    if (!email) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }

    const normalized = email.toLowerCase().trim();

    // Always respond with 200 to avoid email enumeration
    const user = await db.query.orgUsers.findFirst({
      where: eq(orgUsers.email, normalized),
    });

    if (user) {
      const token     = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db
        .update(orgUsers)
        .set({ resetToken: token, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(orgUsers.id, user.id));

      const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      await sendEmail({
        to:      normalized,
        subject: "Recuperar contraseña — DocuIA",
        html:    buildResetEmail({ email: normalized, resetUrl }),
      });
    }

    return NextResponse.json({
      ok:      true,
      message: "Si el email existe, recibirás un enlace de recuperación.",
    });
  } catch (err) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
