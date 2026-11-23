// The PDF previews load pdf.js's worker from /pdf.worker.min.mjs, a copy kept
// in public/. It must be the worker of the installed pdfjs-dist: pdf.js refuses
// one from another version and every preview stops showing. Run after
// updating react-pdf or pdfjs-dist (a test fails while they differ).
//   npm run sync:pdf-worker
import { copyFileSync } from "node:fs";

copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
console.log("public/pdf.worker.min.mjs actualizado con el de pdfjs-dist instalado.");
