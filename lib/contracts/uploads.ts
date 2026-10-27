import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractLargeUploads } from "@/db/schema";
import { abortMultipartFile, completeMultipartFile, deleteFile, getFileBuffer, getFileRange, getFileSize, listFileParts, startMultipartFile, uploadFilePart } from "@/lib/storage/minio";
import { matchesFileType } from "@/lib/security/files";
import { validateDocx } from "@/lib/security/docx";
import { isFeatureEnabled } from "@/lib/features";

export const CONTRACT_CHUNK_BYTES = 8 * 1024 * 1024;
export const CONTRACT_MAX_PDF_BYTES = 150 * 1024 * 1024;
const MAX_OTHER_BYTES = 20 * 1024 * 1024;
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED = new Set(["application/pdf", WORD_MIME, "image/jpeg", "image/png", "image/webp", "image/tiff", "text/plain", "text/xml", "application/xml"]);

export function validateContractUpload(name: string, mimeType: string, size: number): string | null {
  if (!name || name.length > 240 || /[\\/\x00-\x1f]/.test(name)) return "Nombre de archivo inválido";
  if (!ALLOWED.has(mimeType)) return "Tipo de archivo no permitido";
  if (!Number.isSafeInteger(size) || size < 1) return "Tamaño de archivo inválido";
  if (size > (mimeType === "application/pdf" ? CONTRACT_MAX_PDF_BYTES : MAX_OTHER_BYTES)) return "Archivo demasiado grande";
  return null;
}

export async function createUploadSession(organizationId: string, userId: string, name: string, mimeType: string, sizeBytes: number) {
  const error = validateContractUpload(name, mimeType, sizeBytes);
  if (error) throw new Error(error);
  const id = randomUUID();
  const storageKey = `contracts/${organizationId}/uploads/${id}/${name}`;
  const multipartId = await startMultipartFile(storageKey, mimeType);
  try {
    await db.insert(contractLargeUploads).values({ id, organizationId, createdBy: userId, storageKey, originalName: name, mimeType, sizeBytes, multipartId });
  } catch (error) {
    await abortMultipartFile(storageKey, multipartId).catch(() => undefined);
    throw error;
  }
  return { id, chunkBytes: CONTRACT_CHUNK_BYTES, partCount: Math.ceil(sizeBytes / CONTRACT_CHUNK_BYTES) };
}

export async function getOwnedUpload(id: string, organizationId: string, userId: string) {
  return db.query.contractLargeUploads.findFirst({ where: and(eq(contractLargeUploads.id, id), eq(contractLargeUploads.organizationId, organizationId), eq(contractLargeUploads.createdBy, userId)) });
}

export async function putUploadPart(id: string, orgId: string, userId: string, partNumber: number, bytes: Uint8Array) {
  const upload = await getOwnedUpload(id, orgId, userId);
  if (!upload || upload.status !== "uploading") throw new Error("Carga no disponible");
  const count = Math.ceil(upload.sizeBytes / CONTRACT_CHUNK_BYTES);
  const expected = partNumber === count ? upload.sizeBytes - (count - 1) * CONTRACT_CHUNK_BYTES : CONTRACT_CHUNK_BYTES;
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count || bytes.byteLength !== expected) throw new Error("Parte de carga inválida");
  await uploadFilePart(upload.storageKey, upload.multipartId, partNumber, bytes);
}

export async function finishUpload(id: string, orgId: string, userId: string) {
  const upload = await getOwnedUpload(id, orgId, userId);
  if (!upload || upload.status !== "uploading") throw new Error("Carga no disponible");
  const parts = await listFileParts(upload.storageKey, upload.multipartId);
  const count = Math.ceil(upload.sizeBytes / CONTRACT_CHUNK_BYTES);
  if (parts.length !== count || parts.some((part, i) => part.partNumber !== i + 1 || part.size !== (i === count - 1 ? upload.sizeBytes - i * CONTRACT_CHUNK_BYTES : CONTRACT_CHUNK_BYTES))) {
    throw new Error("Faltan partes o el tamaño de la carga no coincide");
  }
  await completeMultipartFile(upload.storageKey, upload.multipartId, parts);
  const [actualSize, header] = await Promise.all([getFileSize(upload.storageKey), getFileRange(upload.storageKey, 0, Math.min(4095, upload.sizeBytes - 1))]);
  const textType = ["text/plain", "text/xml", "application/xml"].includes(upload.mimeType);
  const signatureBytes = textType ? await getFileBuffer(upload.storageKey, MAX_OTHER_BYTES) : header;
  let validType = upload.mimeType === WORD_MIME ? header.subarray(0, 2).toString() === "PK" : matchesFileType(signatureBytes, upload.mimeType);
  if (validType && upload.mimeType === WORD_MIME) {
    try { await validateDocx(await getFileBuffer(upload.storageKey, MAX_OTHER_BYTES)); }
    catch { validType = false; }
  }
  if (actualSize !== upload.sizeBytes || !validType) {
    await deleteFile(upload.storageKey);
    await db.update(contractLargeUploads).set({ status: "invalid" }).where(eq(contractLargeUploads.id, id));
    throw new Error("El archivo cargado no coincide con el tipo o tamaño indicado");
  }
  await db.update(contractLargeUploads).set({ status: "completed", completedAt: new Date() }).where(and(eq(contractLargeUploads.id, id), eq(contractLargeUploads.status, "uploading")));
  return { id, name: upload.originalName, sizeBytes: upload.sizeBytes };
}

export async function cancelUpload(id: string, orgId: string, userId: string) {
  const upload = await getOwnedUpload(id, orgId, userId);
  if (!upload || !["uploading", "completed"].includes(upload.status)) return;
  const claimed = await db.update(contractLargeUploads).set({ status: "aborted" }).where(and(eq(contractLargeUploads.id, id), eq(contractLargeUploads.status, upload.status), isNull(contractLargeUploads.claimedBy))).returning({ id: contractLargeUploads.id });
  if (!claimed.length) return;
  if (upload.status === "uploading") await abortMultipartFile(upload.storageKey, upload.multipartId).catch(() => undefined);
  else await deleteFile(upload.storageKey).catch(() => undefined);
}

export async function createCaseFromUploads(input: { organizationId: string; createdBy: string; title?: string; flowId?: string; uploadIds: string[] }) {
  if (input.uploadIds.length < 1 || input.uploadIds.length > 10 || new Set(input.uploadIds).size !== input.uploadIds.length) throw new Error("Selecciona de 1 a 10 archivos distintos");
  const uploads = await Promise.all(input.uploadIds.map((id) => getOwnedUpload(id, input.organizationId, input.createdBy)));
  if (uploads.some((upload) => !upload || upload.status !== "completed")) throw new Error("Hay archivos que no terminaron de cargar");
  const files = uploads as NonNullable<(typeof uploads)[number]>[];
  if (files.some((upload) => upload.mimeType === WORD_MIME)) throw new Error("Word puede cargarse al Archivo, pero los casos aceptan PDF, imágenes y texto");
  if (files.some((upload) => upload.sizeBytes > MAX_OTHER_BYTES) && !await isFeatureEnabled(input.organizationId, "contract_large_documents")) {
    throw new Error("Documentos extensos no habilitados");
  }
  if (files.reduce((total, upload) => total + upload.sizeBytes, 0) > 300 * 1024 * 1024) throw new Error("El caso supera 300 MB en total");
  const caseId = randomUUID();
  await db.transaction(async (tx) => {
    for (const upload of files) {
      const claimed = await tx.update(contractLargeUploads).set({ status: "claimed", claimedBy: caseId }).where(and(eq(contractLargeUploads.id, upload.id), eq(contractLargeUploads.organizationId, input.organizationId), eq(contractLargeUploads.status, "completed"), isNull(contractLargeUploads.claimedBy))).returning({ id: contractLargeUploads.id });
      if (claimed.length !== 1) throw new Error("El archivo ya fue utilizado por otro caso");
    }
    await tx.insert(contractCases).values({ id: caseId, organizationId: input.organizationId, flowId: input.flowId ?? null, title: input.title ?? null, status: "uploaded", createdBy: input.createdBy });
    await tx.insert(contractDocuments).values(files.map((upload) => ({ id: randomUUID(), caseId, storageKey: upload.storageKey, originalName: upload.originalName, mimeType: upload.mimeType })));
  });
  return caseId;
}
