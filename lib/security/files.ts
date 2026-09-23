/** File.type is supplied by the caller; check file signatures before processing. */
export function matchesFileType(bytes: Uint8Array, mime: string): boolean {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!b.length) return false;
  const hex = b.subarray(0, 16).toString("hex");
  if (mime === "application/pdf") return b.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/webp") return b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  if (mime === "image/tiff") return hex.startsWith("49492a00") || hex.startsWith("4d4d002a");
  if (mime === "image/heic" || mime === "image/heif") return b.subarray(4, 8).toString() === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.subarray(8, 12).toString());
  if (["text/plain", "application/xml", "text/xml"].includes(mime)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(b);
      if (text.includes("\0") || /<!DOCTYPE|<!ENTITY/i.test(text)) return false;
      return mime === "text/plain" || text.trimStart().startsWith("<");
    } catch { return false; }
  }
  return false;
}
