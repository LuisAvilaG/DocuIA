// Files and CFDI fields sent with the ERP request (erp_attachments feature).

import type { historyDocuments } from "@/db/schema";
import { getFeature } from "@/lib/features";
import { getFileBuffer } from "@/lib/storage/minio";
import { parseCfdi, type CfdiData } from "./cfdi-parser";

type HistoryDocument = typeof historyDocuments.$inferSelect;

// RESTlet requests are limited in size; larger files stay only in DocuIA.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export interface ErpAttachment { name: string; kind: "xml" | "pdf"; content_base64: string }

/** Custom field mapping "dato=campo; dato=campo" → { campo: valor } from the CFDI. */
export function cfdiCustomFields(mapping: string, cfdi: CfdiData | null): Record<string, string> {
  if (!cfdi || !mapping.trim()) return {};
  const source: Record<string, string> = {
    uuid: cfdi.uuid, uso_cfdi: cfdi.usoCfdi, metodo_pago: cfdi.metodoPago, forma_pago: cfdi.formaPago,
    serie: cfdi.serie, folio: cfdi.folio, rfc_emisor: cfdi.emisorRfc, rfc_receptor: cfdi.receptorRfc,
  };
  const out: Record<string, string> = {};
  for (const pair of mapping.split(";")) {
    const [key, field] = pair.split("=").map((s) => s.trim());
    if (key && field && /^[a-z0-9_]+$/i.test(field) && source[key]) out[field] = source[key];
  }
  return out;
}

async function readAttachment(key: string | null, name: string, kind: "xml" | "pdf"): Promise<ErpAttachment | null> {
  if (!key) return null;
  try {
    const buffer = await getFileBuffer(key, MAX_ATTACHMENT_BYTES);
    return { name, kind, content_base64: buffer.toString("base64") };
  } catch {
    return null;
  }
}

/** Attachments and CFDI fields for the ERP request, per the erp_attachments feature. */
export async function erpExtras(doc: Pick<HistoryDocument, "organizationId" | "documentType" | "storageKey" | "attachmentKey" | "numDoc">) {
  const feature = await getFeature(doc.organizationId, "erp_attachments");
  if (!feature.isEnabled) return {};
  const cfg = feature.config as { attach_xml?: boolean; attach_pdf?: boolean; folder_id?: string; uuid_field?: string; custom_fields?: string };
  const base = (doc.numDoc || "documento").replace(/[^\w.-]+/g, "_");
  const isCfdi = doc.documentType === "xml_cfdi";
  let cfdi: CfdiData | null = null;
  const attachments: ErpAttachment[] = [];

  if (isCfdi && doc.storageKey) {
    const xml = await readAttachment(doc.storageKey, `${base}.xml`, "xml");
    if (xml) {
      cfdi = parseCfdi(Buffer.from(xml.content_base64, "base64").toString("utf8"));
      if (cfg.attach_xml !== false) attachments.push(xml);
    }
  }
  // The PDF method attaches only its PDF; the CFDI method its paired PDF.
  const pdfKey = isCfdi ? doc.attachmentKey : doc.storageKey;
  if (cfg.attach_pdf !== false && pdfKey && /\.pdf$/i.test(pdfKey)) {
    const pdf = await readAttachment(pdfKey, `${base}.pdf`, "pdf");
    if (pdf) attachments.push(pdf);
  }

  const fields = cfdiCustomFields(cfg.custom_fields ?? "", cfdi);
  if (cfdi?.uuid && cfg.uuid_field && /^[a-z0-9_]+$/i.test(cfg.uuid_field)) fields[cfg.uuid_field] = cfdi.uuid.toUpperCase();

  return {
    ...(attachments.length ? { attachments, attachment_folder_id: cfg.folder_id?.trim() || null } : {}),
    ...(Object.keys(fields).length ? { custom_fields: fields } : {}),
  };
}
