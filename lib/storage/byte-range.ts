// Leer un archivo por partes (`Range: bytes=a-b`). El visor de PDF pide solo
// los tramos que necesita para pintar una página, en vez del archivo completo.

export type ByteRange = { start: number; end: number };

/**
 * The part of a file of `size` bytes that a `Range` header asks for.
 * `null`: no usable range (none, several ranges or a suffix), so the whole file
 * is the answer. `"unsatisfiable"`: it starts beyond the end of the file.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec((header ?? "").trim());
  if (!match || size <= 0) return null;
  const start = Number(match[1]);
  // An open range (`bytes=a-`) runs to the end of the file.
  const last = match[2] === "" ? Infinity : Number(match[2]);
  if (!Number.isSafeInteger(start) || last < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: Math.min(last, size - 1) };
}
