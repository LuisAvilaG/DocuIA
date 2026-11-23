// The model does not take an image over about 5 MB, while uploads and the
// contractor's delivery link accept photos of up to 20 MB. Heavy images are
// reduced before they are sent: a phone photo of a page reads the same at
// 2500 px as at 6000 px. Smaller images go as they are.
import type { AiJsonRequest } from "./provider";

/** Above this a file is re-encoded (base64 adds a third on top of it). */
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_SIDE = 2576;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function shrink(base64: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // Loaded on demand: only heavy images need it.
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(base64, "base64"), { failOn: "none" })
      .rotate() // the orientation the camera recorded
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { base64: out.toString("base64"), mimeType: "image/jpeg" };
  } catch (error) {
    // Without the library, or with an image it cannot read, the file goes as it
    // came: the provider's own answer is then the error the user sees.
    console.error("[ai] no se pudo reducir la imagen", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The same request with its heavy images reduced. */
export async function fitImages(req: AiJsonRequest): Promise<AiJsonRequest> {
  const heavy = (p: AiJsonRequest["parts"][number]) => p.kind === "file" && IMAGE_TYPES.has(p.mimeType) && p.base64.length * 0.75 > MAX_IMAGE_BYTES;
  if (!req.parts.some(heavy)) return req;
  const parts = await Promise.all(req.parts.map(async (p) => {
    if (p.kind !== "file" || !heavy(p)) return p;
    const smaller = await shrink(p.base64);
    return smaller ? { ...p, ...smaller } : p;
  }));
  return { ...req, parts };
}
