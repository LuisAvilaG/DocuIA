import { fromBuffer, type Entry, type ZipFile } from "yauzl";

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
            if (text.includes("\0") || /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']\s*External|Target\s*=\s*["']\s*(https?|file|ftp):|<[^>]*altChunk\b|macroEnabled|vbaProject/i.test(text) || /\b(DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK)\b/i.test(text.replace(/<[^>]+>/g, ""))) {
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
