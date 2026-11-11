// Enlace para que el contratista entregue los documentos pedidos sin crear
// cuenta. El token va en el correo; aquí solo se guarda su hash. El enlace
// vence, sirve para una sola entrega y se anula al generar uno nuevo.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractUploadLinks, organizations } from "@/db/schema";
import { uploadFile } from "@/lib/storage/minio";

export const LINK_DAYS = 14;
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const validToken = (token: string) => /^[A-Za-z0-9_-]{32,64}$/.test(token);

export function uploadLinkUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/entregar/${token}`;
}

/** Crea un enlace nuevo para el caso y anula los anteriores sin usar. */
export async function createUploadLink(input: { orgId: string; caseId: string; userId: string | null; documents: string[]; reason: string; days?: number }): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (input.days ?? LINK_DAYS) * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.update(contractUploadLinks).set({ revokedAt: new Date() })
      .where(and(eq(contractUploadLinks.caseId, input.caseId), isNull(contractUploadLinks.usedAt), isNull(contractUploadLinks.revokedAt)));
    await tx.insert(contractUploadLinks).values({
      id: randomUUID(), organizationId: input.orgId, caseId: input.caseId, tokenHash: hashToken(token),
      documentsJson: input.documents, reason: input.reason, expiresAt, createdBy: input.userId,
    });
  });
  return { token, url: uploadLinkUrl(token), expiresAt };
}

export type LinkState =
  | { ok: true; linkId: string; orgId: string; caseId: string; orgName: string; caseTitle: string; documents: string[]; reason: string | null; expiresAt: Date }
  | { ok: false; reason: "not_found" | "expired" | "used" | "closed" };

/** Qué ve el contratista al abrir el enlace. No expone nada más del caso. */
export async function readUploadLink(token: string, now = new Date()): Promise<LinkState> {
  if (!validToken(token)) return { ok: false, reason: "not_found" };
  const link = await db.query.contractUploadLinks.findFirst({ where: eq(contractUploadLinks.tokenHash, hashToken(token)) });
  if (!link || link.revokedAt) return { ok: false, reason: "not_found" };
  if (link.usedAt) return { ok: false, reason: "used" };
  if (link.expiresAt <= now) return { ok: false, reason: "expired" };
  const [kase, org] = await Promise.all([
    db.query.contractCases.findFirst({ where: and(eq(contractCases.id, link.caseId), eq(contractCases.organizationId, link.organizationId)), columns: { title: true, status: true } }),
    db.query.organizations.findFirst({ where: eq(organizations.id, link.organizationId), columns: { name: true } }),
  ]);
  if (!kase || kase.status !== "awaiting_documents") return { ok: false, reason: "closed" };
  return {
    ok: true, linkId: link.id, orgId: link.organizationId, caseId: link.caseId, orgName: org?.name ?? "",
    caseTitle: kase.title ?? "Caso", documents: Array.isArray(link.documentsJson) ? (link.documentsJson as string[]) : [],
    reason: link.reason, expiresAt: link.expiresAt,
  };
}

const KINDS: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** Tipo real del archivo por su contenido (no por el nombre); null si no se acepta. */
export function sniffFile(buffer: Buffer): string | null {
  return KINDS.find((k) => k.test(buffer))?.mime ?? null;
}

export type DeliveryResult = { ok: true; files: number } | { ok: false; status: number; error: string };

/** Guarda la entrega, vuelve a poner el caso en análisis y cierra el enlace. */
export async function deliverDocuments(token: string, files: Array<{ name: string; buffer: Buffer }>, note: string): Promise<DeliveryResult & { caseId?: string; orgId?: string }> {
  const link = await readUploadLink(token);
  if (!link.ok) return { ok: false, status: 410, error: link.reason === "expired" ? "El enlace venció. Pide uno nuevo a quien te lo envió." : "Este enlace ya no está disponible." };
  if (files.length < 1 || files.length > MAX_FILES) return { ok: false, status: 400, error: `Sube de 1 a ${MAX_FILES} archivos.` };
  const typed: Array<{ name: string; buffer: Buffer; mime: string }> = [];
  for (const f of files) {
    if (f.buffer.length > MAX_FILE_BYTES) return { ok: false, status: 400, error: `«${f.name}» pesa más de ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
    const mime = sniffFile(f.buffer);
    if (!mime) return { ok: false, status: 400, error: `«${f.name}» no es un PDF ni una imagen (PNG o JPG).` };
    typed.push({ ...f, mime });
  }

  const keys: string[] = [];
  for (const f of typed) {
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "documento";
    const key = `contracts/${link.orgId}/${link.caseId}/entregas/${randomUUID()}-${safe}`;
    await uploadFile(f.buffer, key, f.mime);
    keys.push(key);
  }

  const done = await db.transaction(async (tx) => {
    // El enlace se marca usado dentro de la transacción: dos envíos a la vez no entran los dos.
    const used = await tx.update(contractUploadLinks).set({ usedAt: new Date(), filesJson: typed.map((f, i) => ({ name: f.name, key: keys[i], size: f.buffer.length, note: i === 0 && note ? note : undefined })) })
      .where(and(eq(contractUploadLinks.id, link.linkId), isNull(contractUploadLinks.usedAt), isNull(contractUploadLinks.revokedAt)))
      .returning({ id: contractUploadLinks.id });
    if (used.length !== 1) return false;
    const [kase] = await tx.select({ status: contractCases.status }).from(contractCases).where(eq(contractCases.id, link.caseId)).for("update");
    if (!kase || kase.status !== "awaiting_documents") throw new Error("closed");
    for (const [i, f] of typed.entries()) {
      await tx.insert(contractDocuments).values({ id: randomUUID(), caseId: link.caseId, storageKey: keys[i], originalName: f.name.slice(0, 255), mimeType: f.mime, detectedType: null });
    }
    await tx.update(contractCases).set({ status: "uploaded", errorMessage: null, updatedAt: new Date() }).where(eq(contractCases.id, link.caseId));
    return true;
  }).catch(() => false);
  if (!done) return { ok: false, status: 410, error: "Este enlace ya no está disponible." };
  return { ok: true, files: typed.length, caseId: link.caseId, orgId: link.orgId };
}
