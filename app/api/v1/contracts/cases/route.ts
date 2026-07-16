import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractCases } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { createContractCase, type CaseFileInput } from "@/lib/contracts/pipeline";
import { enqueueContractCase } from "@/lib/queue";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/tiff", "text/plain", "text/xml", "application/xml"]);
const MAX_FILE = 20 * 1024 * 1024;

async function guard(orgId: string) {
  return isProductActive(orgId, "contract_intelligence");
}

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });

  const cases = await db.query.contractCases.findMany({
    where: eq(contractCases.organizationId, session.orgId),
    columns: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
    orderBy: [desc(contractCases.createdAt)],
    limit: 200,
  });
  return NextResponse.json({ cases });
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await guard(session.orgId)) return NextResponse.json({ error: "Producto no activo" }, { status: 403 });

  try {
    const form = await req.formData();
    const title = String(form.get("title") ?? "") || undefined;
    const flowId = String(form.get("flowId") ?? "") || undefined;
    const rawFiles = form.getAll("files").filter((f): f is File => f instanceof File);
    if (rawFiles.length === 0) return NextResponse.json({ error: "Se requiere al menos un archivo" }, { status: 400 });

    const files: CaseFileInput[] = [];
    for (const f of rawFiles) {
      if (!ALLOWED.has(f.type)) return NextResponse.json({ error: `Tipo no permitido: ${f.type}` }, { status: 415 });
      if (f.size > MAX_FILE) return NextResponse.json({ error: `${f.name} excede 20 MB` }, { status: 413 });
      files.push({ buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name, mimeType: f.type });
    }

    const caseId = await createContractCase({ organizationId: session.orgId, createdBy: session.sub, title, flowId, files });
    await enqueueContractCase(caseId);
    return NextResponse.json({ ok: true, status: "queued", caseId }, { status: 201 });
  } catch (err) {
    console.error("[contracts/cases POST]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
