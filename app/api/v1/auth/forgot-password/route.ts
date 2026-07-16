import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { sendEmail, buildResetEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/auth/rate-limit";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  try {
    // Throttle to stop reset-email bombing / provider abuse.
    const rl = await rateLimit(`forgot:${clientIp(req)}`, { max: 5, windowSec: 900 });
    if (!rl.ok) {
      return NextResponse.json({ error: "Demasiados intentos. Inténtalo más tarde." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } });
    }

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
      // Store only the SHA-256 hash — a DB read can't be used to hijack the reset.
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db
        .update(orgUsers)
        .set({ resetToken: tokenHash, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
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
