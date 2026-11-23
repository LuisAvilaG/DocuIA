import { clientIp } from "@/lib/security/request-ip";
import { emailSchema, accountRateKey } from "@/lib/auth/input";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orgUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { sendEmail, buildResetEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/auth/rate-limit";


async function handlePOST(req: NextRequest) {
  try {
    // Throttle to stop reset-email bombing / provider abuse.
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`forgot:${ip}`, { max: 5, windowSec: 900 });
    if (!rl.ok) {
      return NextResponse.json({ error: "Demasiados intentos. Inténtalo más tarde." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } });
    }

    const { email } = await req.json() as { email?: string };
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }

    const normalized = parsedEmail.data;
    // Keyed by email + IP: someone who knows the address cannot use up the
    // owner's allowance from another network and block their reset emails.
    const accountLimit = await rateLimit(accountRateKey("forgot", `${normalized}|${ip}`), { max: 3, windowSec: 900 });
    // Ceiling across all IPs so a distributed sender cannot flood the mailbox.
    // Set above what one IP can reach (3 per 15 min = 12 per hour), so it
    // takes several networks to trip it.
    const mailboxLimit = accountLimit.ok
      ? await rateLimit(accountRateKey("forgot-mailbox", normalized), { max: 20, windowSec: 3600 })
      : accountLimit;
    if (!accountLimit.ok || !mailboxLimit.ok) return NextResponse.json({ ok: true, message: "Si el email existe, recibirás un enlace de recuperación." });

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

      const appUrl  = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      // Not awaited: waiting for the mail provider made the answer slower only
      // when the address has an account, which told them apart.
      void sendEmail({
        to:      normalized,
        subject: "Recuperar contraseña — DocuIA",
        html:    buildResetEmail({ email: normalized, resetUrl }),
      }).catch((err) => console.error("[forgot-password] email", err instanceof Error ? err.message : err));
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

export const POST = withApiSecurity(handlePOST);
