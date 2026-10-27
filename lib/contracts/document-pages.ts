import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import PizZip from "pizzip";
import { getFileBuffer, getFileStream } from "@/lib/storage/minio";
import { validateDocx } from "@/lib/security/docx";
import type { IndexedPageText } from "./reference-codes";

const run = promisify(execFile);
const MAX_PAGES = 1500;

function xmlText(xml: string): string {
  return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function plainText(key: string, mimeType: string): Promise<string> {
  const buffer = await getFileBuffer(key, 21 * 1024 * 1024);
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    await validateDocx(buffer);
    const zip = new PizZip(buffer);
    return xmlText(zip.file("word/document.xml")?.asText() ?? "");
  }
  return buffer.toString("utf8");
}

/** Extracts one PDF page at a time. Empty digital pages alone need OCR. */
export async function forEachDocumentPage(input: {
  storageKey: string;
  mimeType: string;
  onTotal?: (count: number) => Promise<void>;
  onPage: (page: IndexedPageText & { ocrMode: "digital" | "scanned" }) => Promise<void>;
  skipPage?: (page: number) => boolean;
}): Promise<void> {
  if (input.mimeType !== "application/pdf" && !input.mimeType.startsWith("image/")) {
    const text = await plainText(input.storageKey, input.mimeType);
    await input.onTotal?.(1);
    if (!input.skipPage?.(1)) await input.onPage({ pageNumber: 1, text, ocrMode: "digital" });
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "docuia-pages-"));
  const file = join(dir, input.mimeType === "application/pdf" ? "source.pdf" : "source-image");
  try {
    await pipeline(await getFileStream(input.storageKey), createWriteStream(file));
    if (input.mimeType.startsWith("image/")) {
      await input.onTotal?.(1);
      if (!input.skipPage?.(1)) {
        const { stdout } = await run("tesseract", [file, "stdout", "-l", "spa+eng"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
        await input.onPage({ pageNumber: 1, text: stdout, ocrMode: "scanned" });
      }
      return;
    }
    const { stdout: info } = await run("pdfinfo", [file], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const count = Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PAGES) throw new Error(`PDF fuera del límite de ${MAX_PAGES} páginas`);
    await input.onTotal?.(count);
    const digitalTextFile = join(dir, "digital.txt");
    // One Poppler pass avoids reopening and reparsing a 150 MB source for
    // every page. The resulting text is streamed page by page below.
    await run("pdftotext", ["-layout", "-enc", "UTF-8", file, digitalTextFile], { timeout: 300_000, maxBuffer: 1024 * 1024 });
    async function emitPage(pageNumber: number, digital: string) {
      if (input.skipPage?.(pageNumber)) return;
      let text = digital.trim();
      let ocrMode: "digital" | "scanned" = "digital";
      if (text.length < 60) {
        const prefix = join(dir, `page-${pageNumber}`);
        await run("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-scale-to", "1800", "-gray", "-png", file, prefix], { timeout: 90_000, maxBuffer: 1024 * 1024 });
        const image = `${prefix}.png`;
        const { stdout } = await run("tesseract", [image, "stdout", "-l", "spa+eng"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
        // OCR can be empty or worse than a short, perfectly valid digital
        // header. Never discard text that Poppler already recovered.
        const ocrText = stdout.trim();
        if (ocrText.length > text.length) { text = ocrText; ocrMode = "scanned"; }
        await rm(image, { force: true });
      }
      await input.onPage({ pageNumber, text, ocrMode });
    }
    const decoder = new StringDecoder("utf8");
    let pageNumber = 1;
    let pending = "";
    for await (const chunk of createReadStream(digitalTextFile, { highWaterMark: 64 * 1024 })) {
      pending += decoder.write(chunk as Buffer);
      let end = pending.indexOf("\f");
      while (end !== -1) {
        if (pageNumber <= count) await emitPage(pageNumber, pending.slice(0, end));
        pageNumber++;
        pending = pending.slice(end + 1);
        end = pending.indexOf("\f");
      }
      if (pending.length > 4 * 1024 * 1024) throw new Error("Texto de página demasiado grande");
    }
    pending += decoder.end();
    while (pageNumber <= count) {
      await emitPage(pageNumber, pending);
      pending = "";
      pageNumber++;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readDocxText(buffer: Buffer): Promise<string> {
  await validateDocx(buffer);
  return xmlText(new PizZip(buffer).file("word/document.xml")?.asText() ?? "");
}
