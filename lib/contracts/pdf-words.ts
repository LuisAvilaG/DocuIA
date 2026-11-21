// Text of a PDF page with the position of each word, read from the PDF's own
// text layer in the browser (pdf.js). Used to place a citation on the page and
// to know which words lie under a zone drawn on it.
import type { WordBox } from "./evidence";

export type PdfTextPage = { view: number[]; getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }> }> };
export type PdfTextDoc = { numPages: number; getPage: (n: number) => Promise<PdfTextPage> };

/** Palabras con posición (0–1) de una página, desde la capa de texto del PDF. */
export async function pageWords(pdf: PdfTextDoc, n: number): Promise<WordBox[]> {
  const page = await pdf.getPage(n);
  const [vx, vy, vx2, vy2] = page.view;
  const W = vx2 - vx, H = vy2 - vy;
  const { items } = await page.getTextContent();
  const out: WordBox[] = [];
  for (const it of items) {
    if (!it.str || !it.transform || !it.width) continue;
    const [, , c, d, e, f] = it.transform;
    const fontH = Math.hypot(c, d) || it.height || 10;
    const len = it.str.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.str))) {
      const x1 = e - vx + it.width * (m.index / len);
      const x2 = e - vx + it.width * ((m.index + m[0].length) / len);
      out.push({ text: m[0], x1: x1 / W, x2: x2 / W, y1: 1 - (f - vy + fontH * 0.85) / H, y2: 1 - (f - vy - fontH * 0.2) / H });
    }
  }
  return out;
}

/** The words whose centre falls inside a relative area of the page, in reading order. */
export function wordsInArea(words: WordBox[], area: { x: number; y: number; width: number; height: number }): string {
  const inside = words.filter((w) => {
    const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
    return cx >= area.x && cx <= area.x + area.width && cy >= area.y && cy <= area.y + area.height;
  });
  // Lines top to bottom (words of one line share their top within a small margin), then left to right.
  const lines: WordBox[][] = [];
  for (const word of inside.sort((a, b) => a.y1 - b.y1)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y1 - word.y1) < 0.008) line.push(word); else lines.push([word]);
  }
  return lines.map((line) => line.sort((a, b) => a.x1 - b.x1).map((w) => w.text).join(" ")).join(" ").replace(/\s+/g, " ").trim();
}
