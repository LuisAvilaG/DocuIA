import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth/jwt";
import { contractVisualTrainingVariants } from "@/db/schema";
import { getFileStream } from "@/lib/storage/minio";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const { id: flowId, variantId } = await params;
  const variant = await db.query.contractVisualTrainingVariants.findFirst({
    where: and(eq(contractVisualTrainingVariants.id, variantId), eq(contractVisualTrainingVariants.flowId, flowId), eq(contractVisualTrainingVariants.organizationId, session.orgId)),
    columns: { storageKey: true, mimeType: true, originalName: true },
  });
  if (!variant) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  try {
    const stream = await getFileStream(variant.storageKey);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: { "Content-Type": variant.mimeType || "application/octet-stream", "Content-Disposition": `inline; filename="${(variant.originalName || "muestra").replace(/[^\w.-]/g, "_")}"`, "Cache-Control": "private, max-age=3600" } });
  } catch { return NextResponse.json({ error: "No se pudo leer el documento" }, { status: 500 }); }
}
