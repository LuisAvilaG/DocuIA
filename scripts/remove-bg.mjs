import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Smooth edge removal: pixels within FUZZ of pure white get proportional alpha
const FUZZ = 22;

async function removeWhiteBackground(inputPath, outputPath) {
  const img = sharp(inputPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const buf = Buffer.from(data);

  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    // How far is this pixel from pure white (per-channel max deviation)
    const maxDiff = Math.max(255 - r, 255 - g, 255 - b);
    if (maxDiff <= FUZZ) {
      // Smoothly fade to transparent as it approaches white
      buf[i + 3] = Math.round((maxDiff / FUZZ) * 255);
    }
  }

  await sharp(buf, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`✓ ${outputPath.replace(root, "")}`);
}

const jobs = [
  // Root originals
  ["Logo_DocuIA.png",        "Logo_DocuIA.png"],
  ["Logo_DocuIA_icono.png",  "Logo_DocuIA_icono.png"],
  ["Logo_DocuIA_texto.png",  "Logo_DocuIA_texto.png"],
  // Public copies used by the app
  ["public/logo-full.png",   "public/logo-full.png"],
  ["public/logo-icon.png",   "public/logo-icon.png"],
  ["public/logo-text.png",   "public/logo-text.png"],
];

for (const [src, dst] of jobs) {
  await removeWhiteBackground(join(root, src), join(root, dst));
}

console.log("\nListo — todos los fondos eliminados.");
