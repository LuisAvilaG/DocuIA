import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail, buildDemoRequestEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/auth/rate-limit";

const PRODUCT_LABELS: Record<string, string> = {
  ap_automation: "AP Automation",
  expense_management: "Expense Management",
  contract_intelligence: "Contract Intelligence",
};

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(2).max(120),
  products: z.array(z.enum(["ap_automation", "expense_management", "contract_intelligence"])).max(3).optional().default([]),
  volume: z.enum(["<100", "100-500", "500-2000", "2000+"]).optional(),
  message: z.string().trim().max(2000).optional(),
  // Honeypot: real users never fill this hidden field.
  website: z.string().max(0).optional(),
});

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(`contact:${clientIp(req)}`, { max: 5, windowSec: 900 });
    if (!rl.ok) {
      return NextResponse.json({ error: "Demasiados intentos. Inténtalo más tarde." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 900) } });
    }

    const parsed = contactSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Revisa los datos del formulario." }, { status: 400 });
    }

    const data = parsed.data;
    // Bot filled the honeypot: pretend success, send nothing.
    if (data.website) return NextResponse.json({ ok: true });

    const to = process.env.CONTACT_EMAIL ?? "ventas@docuia.com";
    const { ok } = await sendEmail({
      to,
      subject: `Solicitud de demo — ${data.company}`,
      html: buildDemoRequestEmail({
        name: data.name,
        email: data.email,
        company: data.company,
        products: data.products.map((p) => PRODUCT_LABELS[p] ?? p),
        volume: data.volume ?? "",
        message: data.message ?? "",
      }),
    });

    if (!ok) {
      return NextResponse.json({ error: "No pudimos enviar tu solicitud. Escríbenos directamente." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
