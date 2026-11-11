// Posición de las palabras en una página escaneada, con OCR (tesseract TSV).
// Solo se usa para las páginas que cita un hallazgo, así que el costo es bajo.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { getFileStream } from "@/lib/storage/minio";
import type { WordBox } from "./evidence";

const run = promisify(execFile);

/** Palabras con posición (0–1) desde la salida TSV de tesseract. */
export function parseTesseractTsv(tsv: string): WordBox[] {
  const lines = tsv.split(/\r?\n/);
  const header = lines.shift()?.split("\t") ?? [];
  const col = (name: string) => header.indexOf(name);
  const iLevel = col("level"), iLeft = col("left"), iTop = col("top"), iW = col("width"), iH = col("height"), iConf = col("conf"), iText = col("text");
  if ([iLevel, iLeft, iTop, iW, iH, iText].some((i) => i < 0)) return [];
  let pageW = 0, pageH = 0;
  const out: WordBox[] = [];
  for (const line of lines) {
    const c = line.split("\t");
    if (c.length <= iText) continue;
    const level = Number(c[iLevel]);
    const [left, top, w, h] = [c[iLeft], c[iTop], c[iW], c[iH]].map(Number);
    if (level === 1) { pageW = w; pageH = h; continue; }
    const text = c[iText]?.trim();
    if (level !== 5 || !text || !pageW || !pageH) continue;
    if (iConf >= 0 && Number(c[iConf]) < 0) continue;
    out.push({ text, x1: left / pageW, y1: top / pageH, x2: (left + w) / pageW, y2: (top + h) / pageH });
  }
  return out;
}

/** OCR de una página (PDF) o de una imagen; [] si no hay herramientas o falla. */
export async function ocrPageWords(storageKey: string, mimeType: string, page: number): Promise<WordBox[]> {
  const dir = await mkdtemp(join(tmpdir(), "docuia-ocrbox-"));
  try {
    const source = join(dir, mimeType === "application/pdf" ? "source.pdf" : "source-image");
    await pipeline(await getFileStream(storageKey), createWriteStream(source));
    let image = source;
    if (mimeType === "application/pdf") {
      const prefix = join(dir, "page");
      await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1800", "-gray", "-png", source, prefix], { timeout: 90_000, maxBuffer: 1024 * 1024 });
      image = `${prefix}.png`;
    }
    const { stdout } = await run("tesseract", [image, "stdout", "-l", "spa+eng", "tsv"], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return parseTesseractTsv(stdout);
  } catch (err) {
    console.warn("[contracts] OCR de posiciones no disponible", err instanceof Error ? err.message : err);
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
