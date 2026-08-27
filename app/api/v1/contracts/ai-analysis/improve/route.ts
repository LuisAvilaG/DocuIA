import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { improveAiAnalysisPrompt } from "@/lib/contracts/ai-analysis";

export async function POST(req: NextRequest) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden mejorar prompts de flujo." }, { status: 403 });
  if (!await isProductActive(session.orgId, "contract_intelligence")) return NextResponse.json({ error: "Contract Intelligence no está activo" }, { status: 403 });
  const body = await req.json().catch(() => null) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 12 || prompt.length > 10000) return NextResponse.json({ error: "Escribe una instrucción entre 12 y 10,000 caracteres." }, { status: 400 });
  try {
    return NextResponse.json({ prompt: await improveAiAnalysisPrompt(prompt) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo mejorar el prompt." }, { status: 502 });
  }
}
