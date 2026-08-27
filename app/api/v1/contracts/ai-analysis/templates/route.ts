import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { db } from "@/lib/db";
import { contractAiAnalysisTemplates } from "@/db/schema";

function validConfig(input: unknown): input is { kind: "ai_analysis"; prompt: string } & Record<string, unknown> {
  return !!input && typeof input === "object" &&
    (input as { kind?: unknown }).kind === "ai_analysis" &&
    typeof (input as { prompt?: unknown }).prompt === "string" &&
    (input as { prompt: string }).prompt.trim().length > 0;
}

async function guard() {
  const session = await getTenantSession();
  if (!session) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) } as const;
  if (!await isProductActive(session.orgId, "contract_intelligence")) {
    return { error: NextResponse.json({ error: "Contract Intelligence no está activo" }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export async function GET() {
  const access = await guard();
  if ("error" in access) return access.error;
  const templates = await db.query.contractAiAnalysisTemplates.findMany({
    where: and(eq(contractAiAnalysisTemplates.organizationId, access.session.orgId), eq(contractAiAnalysisTemplates.isActive, true)),
    orderBy: [desc(contractAiAnalysisTemplates.updatedAt)],
    columns: { id: true, name: true, description: true, configJson: true, updatedAt: true },
  });
  return NextResponse.json({ templates: templates.map((template) => ({
    ...template,
    config: validConfig(template.configJson) ? template.configJson : null,
  })) });
}

export async function POST(req: NextRequest) {
  const access = await guard();
  if ("error" in access) return access.error;
  if (access.session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const body = await req.json().catch(() => null) as { name?: unknown; description?: unknown; config?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : null;
  if (!name || name.length > 150) return NextResponse.json({ error: "Escribe un nombre de hasta 150 caracteres." }, { status: 400 });
  if (!validConfig(body?.config)) return NextResponse.json({ error: "La plantilla de análisis no es válida." }, { status: 400 });

  const template = {
    id: randomUUID(), organizationId: access.session.orgId, name, description,
    configJson: body.config, createdBy: access.session.sub, isActive: true, updatedAt: new Date(),
  };
  await db.insert(contractAiAnalysisTemplates).values(template);
  return NextResponse.json({ ok: true, template: { ...template, config: template.configJson } }, { status: 201 });
}
