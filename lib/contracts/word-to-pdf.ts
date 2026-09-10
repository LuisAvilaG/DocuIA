import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Converts a finished DOCX to PDF with LibreOffice. It runs in a dedicated
 * temporary profile so concurrent requests never contend for its user folder.
 * The runner image installs LibreOffice explicitly; keeping conversion here
 * avoids lossy client-side or text-only PDF fallbacks.
 */
export async function convertWordToPdf(word: Buffer, originalName: string): Promise<Buffer> {
  const workingDir = await mkdtemp(join(tmpdir(), "docuia-word-"));
  const sourceName = basename(originalName).toLowerCase().endsWith(".docx")
    ? basename(originalName)
    : `${basename(originalName)}.docx`;
  const sourcePath = join(workingDir, sourceName);
  const profileDir = join(workingDir, "profile");
  const pdfPath = join(workingDir, `${parse(sourceName).name}.pdf`);

  try {
    await writeFile(sourcePath, word);
    await execFileAsync("soffice", [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=file://${profileDir}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      workingDir,
      sourcePath,
    ], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });

    return await readFile(pdfPath);
  } catch (error) {
    throw new Error(`No fue posible convertir el Word a PDF${error instanceof Error && error.message ? `: ${error.message}` : ""}`);
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}
