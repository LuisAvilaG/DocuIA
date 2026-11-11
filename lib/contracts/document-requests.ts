// Pedir documentos al contratista (feature contract_document_requests). Puro: el
// correo sugerido a partir de lo que se leyó y el cuerpo del mensaje.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function isEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim()) && value.length <= 191;
}

/**
 * Correo del contratista leído de los documentos: primero campos que se llaman
 * «correo»/«email», luego cualquier valor que contenga un correo.
 */
export function suggestContractorEmail(docs: Array<{ values: Record<string, unknown> }>): string | null {
  const flat = docs.flatMap((d) => Object.entries(d.values).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x] as const)));
  const pick = (entries: ReadonlyArray<readonly [string, unknown]>) => {
    for (const [, v] of entries) {
      const m = typeof v === "string" ? v.match(EMAIL_RE) : null;
      if (m) return m[0].toLowerCase();
    }
    return null;
  };
  return pick(flat.filter(([k]) => /correo|e-?mail|mail/i.test(k))) ?? pick(flat);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));

/** Cuerpo del correo: plantilla del cliente (si la hay), mensaje, motivo y documentos pedidos. */
export function buildRequestEmail(opts: { template?: string | null; senderName?: string | null; caseTitle: string; message: string; reason: string; documents: string[]; uploadUrl?: string | null; expiresAt?: Date | null }): { subject: string; html: string } {
  const sender = opts.senderName?.trim() || "DocuIA";
  const parts = [
    opts.template?.trim() ? `<p>${esc(opts.template.trim()).replace(/\n/g, "<br>")}</p>` : "",
    opts.message.trim() ? `<p>${esc(opts.message.trim()).replace(/\n/g, "<br>")}</p>` : "",
    `<p><b>Motivo:</b> ${esc(opts.reason)}</p>`,
    opts.documents.length ? `<p><b>Documentos que necesitamos:</b></p><ul>${opts.documents.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "",
    opts.uploadUrl
      ? `<p><a href="${esc(opts.uploadUrl)}" style="display:inline-block;background:#0E7C70;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Subir los documentos</a></p>` +
        `<p style="color:#6B6F7E;font-size:13px">No necesitas cuenta.${opts.expiresAt ? ` El enlace vence el ${esc(opts.expiresAt.toLocaleDateString("es-MX", { day: "numeric", month: "long" }))}` : ""} y sirve para una sola entrega.</p>`
      : "",
    `<p style="color:#6B6F7E;font-size:13px">${esc(sender)} · ${esc(opts.caseTitle)}</p>`,
  ];
  return { subject: `Documentos pendientes · ${opts.caseTitle}`, html: parts.filter(Boolean).join("") };
}
