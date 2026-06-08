import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isFeatureEnabled } from "@/lib/features";
import { extractExpenseDocument } from "@/lib/expense/extract";
import { uploadFile } from "@/lib/storage/minio";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptField } from "@/lib/crypto/encrypt";
import { randomUUID } from "crypto";

const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await isFeatureEnabled(session.orgId, "expense_management")) {
    return NextResponse.json({ error: "Módulo de gastos no activado" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "Se requiere un archivo" }, { status: 400 });
    if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: `Tipo no soportado: ${file.type}` }, { status: 415 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "Archivo mayor a 20 MB" }, { status: 413 });

    const [buffer, orgRow] = await Promise.all([
      file.arrayBuffer().then(ab => Buffer.from(ab)),
      db.query.organizations.findFirst({
        where: eq(organizations.id, session.orgId),
        columns: { aiApiKeyEncrypted: true },
      }),
    ]);

    const apiKey  = orgRow?.aiApiKeyEncrypted ? decryptField(orgRow.aiApiKeyEncrypted) : undefined;
    const fileKey = `expenses/${session.orgId}/${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;

    const [, ocrResult] = await Promise.all([
      uploadFile(buffer, fileKey, file.type),
      extractExpenseDocument(buffer, file.type, { apiKey }),
    ]);

    return NextResponse.json({ ok: true, fileKey, ocr: ocrResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[expenses/ocr]", msg);
    if (msg.includes("GOOGLE_API_KEY") || msg.includes("clave de IA")) {
      return NextResponse.json({ error: "Clave de IA no configurada para este cliente. Configúrala en el panel de administración." }, { status: 503 });
    }
    if (msg.includes("Gemini error")) {
      return NextResponse.json({ error: `Error del servicio OCR: ${msg}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Error al procesar el documento" }, { status: 500 });
  }
}
