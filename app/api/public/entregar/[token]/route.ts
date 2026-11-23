import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/auth/rate-limit";
import { logAudit } from "@/lib/audit/log";
import { enqueueContractCase } from "@/lib/queue";
import { sendEmail } from "@/lib/email/send";
import { deliverDocuments, hashToken } from "@/lib/contracts/upload-links";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Entrega pública del contratista: sin sesión, autorizada solo por el enlace. */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = await rateLimit(`entregar:${hashToken(token).slice(0, 24)}`, { max: 6, windowSec: 3600 });
  if (!rl.ok) return NextResponse.json({ error: "Demasiados intentos. Prueba más tarde." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const files: Array<{ name: string; buffer: Buffer }> = [];
  for (const value of form.getAll("files")) {
    if (typeof value === "string") continue;
    files.push({ name: value.name || "documento", buffer: Buffer.from(await value.arrayBuffer()) });
  }
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);

  const result = await deliverDocuments(token, files, note);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // The delivery is already saved and the link used: if the queue is down the
  // contractor must not see an error. The stuck-case watchdog enqueues it again.
  await enqueueContractCase(result.caseId!).catch((err) => console.error("[entregar] enqueue failed", result.caseId, err));
  await logAudit({ orgId: result.orgId!, action: "contract.documents_delivered", resourceType: "contract_case", resourceId: result.caseId!, metadata: { files: result.files, by: "contratista", note: note || undefined } });

  // Avisa a quien pidió los documentos.
  const kase = await db.query.contractCases.findFirst({ where: eq(contractCases.id, result.caseId!), columns: { title: true, resultJson: true } });
  const requester = (kase?.resultJson as { documentRequest?: { byEmail?: string | null } } | null)?.documentRequest?.byEmail;
  if (requester) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    await sendEmail({
      to: requester,
      subject: `El contratista entregó documentos · ${kase?.title ?? "Caso"}`,
      html: `<p>Llegaron ${result.files} documento${result.files === 1 ? "" : "s"} para <b>${esc(kase?.title ?? "el caso")}</b>. El caso se está analizando de nuevo.</p>${note ? `<p><b>Nota del contratista:</b> ${esc(note)}</p>` : ""}<p><a href="${base}/contracts/${result.caseId}">Abrir el caso</a></p>`,
    }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, files: result.files });
}

export const POST = withApiSecurity(handlePOST);
