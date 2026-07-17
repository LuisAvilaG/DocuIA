const FROM = "DocuIA <noreply@docuia.com>";

// Escape user-controlled values before interpolating into email HTML so a
// crafted name/purpose/reason can't inject markup into the recipient's client.
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`\n[email:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    return { ok: res.ok };
  } catch (err) {
    console.error("[email] send error:", err);
    return { ok: false };
  }
}

export function buildInviteEmail(opts: {
  fullName: string;
  orgName: string;
  email: string;
  tempPassword: string;
  appUrl: string;
}): string {
  const { fullName, orgName, email, tempPassword, appUrl } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Bienvenido a DocuIA</h2>
    <p style="color:#555;margin:0 0 24px">
      Hola ${esc(fullName || email)}, has sido invitado a unirte a <strong>${esc(orgName)}</strong>.
    </p>
    <p style="margin:0 0 8px;font-size:14px">Tus credenciales de acceso:</p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px;font-family:monospace">
      <p style="margin:0 0 4px;font-size:11px;color:#888;font-family:sans-serif">Email</p>
      <p style="margin:0 0 16px">${esc(email)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888;font-family:sans-serif">Contraseña temporal</p>
      <p style="margin:0;font-size:20px;letter-spacing:2px">${tempPassword}</p>
    </div>
    <a href="${appUrl}/login" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500;font-family:sans-serif">
      Ingresar a DocuIA →
    </a>
    <p style="color:#999;font-size:12px;margin:24px 0 0;font-family:sans-serif">
      Por seguridad, cambia tu contraseña en el primer inicio de sesión.
    </p>
  </div>`;
}

// ── Expense module emails ─────────────────────────────────────────────

export function buildExpenseSubmittedEmail(opts: {
  submitterName: string;
  purpose: string;
  totalAmount: string;
  reportUrl: string;
}): string {
  const { submitterName, purpose, totalAmount, reportUrl } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Informe de gastos pendiente de aprobación</h2>
    <p style="color:#555;margin:0 0 24px">
      <strong>${esc(submitterName)}</strong> ha enviado un informe de gastos que requiere tu revisión.
    </p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:11px;color:#888">Propósito</p>
      <p style="margin:0 0 16px;font-weight:500">${esc(purpose)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Total del informe</p>
      <p style="margin:0;font-size:20px;font-weight:700">${totalAmount}</p>
    </div>
    <a href="${reportUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">
      Revisar informe →
    </a>
  </div>`;
}

export function buildExpenseApprovedEmail(opts: {
  submitterName: string;
  purpose: string;
  totalAmount: string;
  reportUrl: string;
}): string {
  const { submitterName, purpose, totalAmount, reportUrl } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Tu informe de gastos fue aprobado</h2>
    <p style="color:#555;margin:0 0 24px">
      Hola ${esc(submitterName)}, tu informe de gastos ha sido <strong style="color:#16a34a">aprobado</strong> y será procesado en NetSuite próximamente.
    </p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:11px;color:#888">Propósito</p>
      <p style="margin:0 0 16px;font-weight:500">${esc(purpose)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Total aprobado</p>
      <p style="margin:0;font-size:20px;font-weight:700">${totalAmount}</p>
    </div>
    <a href="${reportUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">
      Ver informe →
    </a>
  </div>`;
}

export function buildExpenseRejectedEmail(opts: {
  submitterName: string;
  purpose: string;
  reason: string;
  reportUrl: string;
}): string {
  const { submitterName, purpose, reason, reportUrl } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Tu informe de gastos fue rechazado</h2>
    <p style="color:#555;margin:0 0 24px">
      Hola ${esc(submitterName)}, tu informe de gastos ha sido <strong style="color:#dc2626">rechazado</strong>.
    </p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:11px;color:#888">Propósito</p>
      <p style="margin:0 0 16px;font-weight:500">${esc(purpose)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Motivo del rechazo</p>
      <p style="margin:0;color:#dc2626">${esc(reason)}</p>
    </div>
    <a href="${reportUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">
      Ver informe →
    </a>
    <p style="color:#999;font-size:12px;margin:24px 0 0">
      Puedes corregir y volver a enviar el informe.
    </p>
  </div>`;
}

export function buildDemoRequestEmail(opts: {
  name: string;
  email: string;
  company: string;
  products: string[];
  volume: string;
  message: string;
}): string {
  const { name, email, company, products, volume, message } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Nueva solicitud de demo</h2>
    <p style="color:#555;margin:0 0 24px">
      Alguien pidió una demo de DocuIA desde la página web.
    </p>
    <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:11px;color:#888">Nombre</p>
      <p style="margin:0 0 16px;font-weight:500">${esc(name)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Email</p>
      <p style="margin:0 0 16px">${esc(email)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Empresa</p>
      <p style="margin:0 0 16px;font-weight:500">${esc(company)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Productos de interés</p>
      <p style="margin:0 0 16px">${esc(products.length ? products.join(", ") : "No especificado")}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Documentos por mes</p>
      <p style="margin:0 0 16px">${esc(volume || "No especificado")}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#888">Mensaje</p>
      <p style="margin:0;white-space:pre-wrap">${esc(message || "Sin mensaje")}</p>
    </div>
    <a href="mailto:${esc(email)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">
      Responder a ${esc(name)} →
    </a>
  </div>`;
}

export function buildResetEmail(opts: { email: string; resetUrl: string }): string {
  const { email, resetUrl } = opts;
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 8px">Recuperar contraseña</h2>
    <p style="color:#555;margin:0 0 24px">
      Recibimos una solicitud para restablecer la contraseña de <strong>${esc(email)}</strong>.
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500">
      Restablecer contraseña →
    </a>
    <p style="color:#999;font-size:12px;margin:24px 0 0">
      Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.
    </p>
  </div>`;
}
