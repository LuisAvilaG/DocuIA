import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const ALLOWED = new Set(["docuia-catalog-v1.js", "docuia-process-v1.js"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  if (!ALLOWED.has(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = join(process.cwd(), "scripts", "netsuite", filename);
  try {
    const content = await readFile(filePath, "utf-8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/javascript",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
