import { fromBuffer, type Entry, type ZipFile } from "yauzl";

// Field codes that fetch or execute external content. They are only dangerous
// inside a field instruction, never as ordinary words ("Link de pago").
// The code is the first word of the instruction; the rest are its arguments
// (the URL of a HYPERLINK may well contain "link").
const DANGEROUS_FIELD = /^[\s"']*(DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK)(?![A-Za-z])/i;

const decodeEntities = (text: string) => text
  .replace(/&#(x?)([0-9a-f]+);/gi, (_m, hex: string, code: string) => String.fromCodePoint(parseInt(code, hex ? 16 : 10) || 32))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The instruction of every field, one string per field. Word splits an
 * instruction into several runs and joins them with nothing in between, so
 * "INCLUDE" + "PICTURE" is INCLUDEPICTURE: the runs of a field are
 * concatenated as Word does, and each field is kept apart from the next.
 */
export function fieldInstructions(xml: string): string[] {
  const fields: string[] = [];
  const open: string[] = [];
  const token = /<w:fldChar\b[^>]*\bw:fldCharType\s*=\s*["'](begin|separate|end)["'][^>]*>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi;
  for (const m of xml.matchAll(token)) {
    if (m[1]) {
      const type = m[1].toLowerCase();
      if (type === "begin") open.push("");
      else if (type === "end" && open.length) fields.push(open.pop()!);
    } else if (open.length) {
      open[open.length - 1] += m[2];
    } else {
      fields.push(m[2]);
    }
  }
  fields.push(...open);
  for (const m of xml.matchAll(/<w:fldSimple\b[^>]*\bw:instr\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) fields.push(m[1] ?? m[2] ?? "");
  return fields.map(decodeEntities);
}

export function hasDangerousField(xml: string): boolean {
  return fieldInstructions(xml).some((instruction) => DANGEROUS_FIELD.test(instruction));
}

// External relationships are fetched by Word/LibreOffice (images, frames,
// templates) and are rejected; a clickable web or mail hyperlink is not
// fetched and is allowed, e.g. a company website in the footer.
function hasForbiddenRelationship(rels: string): boolean {
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/gi)) {
    const external = /TargetMode\s*=\s*["']\s*External/i.test(tag);
    const target = /\bTarget\s*=\s*["']\s*([^"']*)/i.exec(tag)?.[1]?.trim() ?? "";
    const remote = /^(https?|file|ftp|smb):/i.test(target) || target.startsWith("//") || target.startsWith("\\\\");
    if (!external && !remote) continue;
    const hyperlink = /\bType\s*=\s*["'][^"']*\/hyperlink["']/i.test(tag);
    if (!(hyperlink && /^(https?:\/\/|mailto:)/i.test(target))) return true;
  }
  return false;
}

/** Bound actual decompression before PizZip/LibreOffice sees a DOCX. Reject
 * macros, embedded executables, external relationships and dynamic includes. */
export async function validateDocx(buffer: Buffer): Promise<void> {
  if (buffer.length > 20 * 1024 * 1024) throw new Error("DOCX demasiado grande");
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, archive) => err || !archive ? reject(new Error("DOCX inválido")) : resolve(archive));
  });
  await new Promise<void>((resolve, reject) => {
    let entries = 0, total = 0;
    const names = new Set<string>();
    const fail = (err: unknown) => { clearTimeout(timer); zip.close(); reject(err); };
    const timer = setTimeout(() => fail(new Error("DOCX demasiado complejo")), 15_000);
    zip.on("close", () => clearTimeout(timer));
    zip.on("error", fail);
    zip.on("end", () => {
      clearTimeout(timer);
      if (!names.has("word/document.xml") || !names.has("[Content_Types].xml")) return fail(new Error("No es un documento Word"));
      resolve();
    });
    zip.on("entry", (entry: Entry) => {
      const name = entry.fileName;
      if (++entries > 2000 || names.has(name) || /vbaProject|activeX|embeddings\//i.test(name) || (entry.generalPurposeBitFlag & 1)) return fail(new Error("Contenido Word no permitido"));
      names.add(name);
      if (entry.uncompressedSize > 20 * 1024 * 1024) return fail(new Error("Parte Word demasiado grande"));
      if (name.endsWith("/")) { zip.readEntry(); return; }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(new Error("DOCX inválido"));
        const xml = /\.(xml|rels)$/i.test(name);
        const chunks: Buffer[] = [];
        let partSize = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length; partSize += chunk.length;
          if (total > 60 * 1024 * 1024 || partSize > (xml ? 5 : 20) * 1024 * 1024) {
            stream.destroy(); return fail(new Error("DOCX descomprimido demasiado grande"));
          }
          if (xml) chunks.push(chunk);
        });
        stream.on("error", fail);
        stream.on("end", () => {
          if (xml) {
            const text = Buffer.concat(chunks).toString("utf8").replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(Math.min(0x10ffff, parseInt(hex || dec, hex ? 16 : 10))));
            if (text.includes("\0") || /<!DOCTYPE|<!ENTITY|<[^>]*altChunk\b|macroEnabled|vbaProject/i.test(text)
              || (/\.rels$/i.test(name) && hasForbiddenRelationship(text))
              || hasDangerousField(text)) {
              return fail(new Error("La plantilla contiene vínculos externos o contenido activo no permitido"));
            }
          }
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}
