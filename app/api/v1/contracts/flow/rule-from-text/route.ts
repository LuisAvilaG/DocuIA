import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { getFeature, isFeatureEnabled } from "@/lib/features";
import { withAiUsage } from "@/lib/ai/usage";
import { ruleFromText, type RuleContext } from "@/lib/contracts/rule-from-text";

/** Convierte un control escrito en palabras en una regla del flujo (no guarda nada). */
async function handlePOST(req: NextRequest) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!await isFeatureEnabled(session.orgId, "contract_flow_builder")) return NextResponse.json({ error: "El constructor de flujos no está habilitado" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { text?: unknown; docTypes?: unknown; fieldsByType?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 8) return NextResponse.json({ error: "Describe el control con un poco más de detalle." }, { status: 400 });
  const docTypes = Array.isArray(body.docTypes)
    ? body.docTypes.flatMap((d) => {
      const x = d as { key?: unknown; name?: unknown };
      return typeof x.key === "string" && x.key ? [{ key: x.key.slice(0, 80), name: String(x.name ?? x.key).slice(0, 120) }] : [];
    }).slice(0, 40)
    : [];
  const fieldsByType: RuleContext["fieldsByType"] = {};
  if (body.fieldsByType && typeof body.fieldsByType === "object") {
    for (const [k, v] of Object.entries(body.fieldsByType as Record<string, unknown>).slice(0, 40)) {
      if (Array.isArray(v)) fieldsByType[k.slice(0, 80)] = v.filter((f): f is string => typeof f === "string").map((f) => f.slice(0, 80)).slice(0, 200);
    }
  }

  const model = (await getFeature(session.orgId, "contract_ai_extraction").catch(() => null))?.config.model;
  try {
    const result = await withAiUsage({ orgId: session.orgId, source: "contratos" }, () => ruleFromText(text, { docTypes, fieldsByType }, typeof model === "string" ? model : undefined));
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 422 });
  } catch (err) {
    console.error("[flow/rule-from-text]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "La IA no respondió. Intenta de nuevo en un momento." }, { status: 502 });
  }
}

export const POST = withApiSecurity(handlePOST);
