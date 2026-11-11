import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { canApprove } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { contractCases, contractLargeUploads, contractValidations } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getOwnedUpload } from "@/lib/contracts/uploads";
import { logAudit } from "@/lib/audit/log";
import { getFeature, isFeatureEnabled } from "@/lib/features";

type Outcome = { error: string; status: number; needsOverride?: boolean } | { blocked: boolean };

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts", permission: "write" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canApprove(session.role, "contracts")) return NextResponse.json({ error: "No tienes permiso para aprobar casos" }, { status: 403 });
  const approvalFeature = await getFeature(session.orgId, "contract_approval_workflow");
  if (!approvalFeature.isEnabled) return NextResponse.json({ error: "La aprobación de contratos no está habilitada para este cliente." }, { status: 403 });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const override = !!body?.override;
  // Aprobar con excepción: las validaciones sin resolver que el aprobador revisó y un soporte opcional.
  const acknowledged = new Set(Array.isArray(body?.acknowledged) ? (body.acknowledged as unknown[]).filter((x): x is number => Number.isSafeInteger(x)) : []);
  const supportUploadId = typeof body?.supportUploadId === "string" ? body.supportUploadId : null;
  const support = supportUploadId ? await getOwnedUpload(supportUploadId, session.orgId, session.sub) : null;
  if (supportUploadId && (!support || support.status !== "completed" || support.claimedBy)) {
    return NextResponse.json({ error: "El soporte no terminó de cargar o ya se usó." }, { status: 400 });
  }
  const validationsEnabled = await isFeatureEnabled(session.orgId, "contract_advanced_validations");
  const allowOverride = approvalFeature.config.allow_override !== false;

  // The case row stays locked while validations are read and the decision is
  // written, so a concurrent correction, rejection or second approval cannot
  // interleave (e.g. approving against validations that were just replaced).
  const outcome: Outcome = await db.transaction(async (tx) => {
    const [kase] = await tx.select({ status: contractCases.status, resultJson: contractCases.resultJson })
      .from(contractCases)
      .where(and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)))
      .for("update");
    if (!kase) return { error: "Caso no encontrado", status: 404 };
    if (kase.status !== "validated") {
      return { error: "Este caso no está listo para aprobar: todavía se valida o ya tiene una decisión.", status: 409 };
    }

    // Gate on blocking validations: cannot approve unless the reviewer overrides + explains.
    const vals = await tx.select({ id: contractValidations.id, ok: contractValidations.ok, severity: contractValidations.severity })
      .from(contractValidations)
      .where(eq(contractValidations.caseId, id));
    const blocked = validationsEnabled && vals.some((v) => v.ok === false && v.severity === "block");
    if (blocked && !override) {
      return { error: "Este caso tiene validaciones bloqueantes. Debes forzar la aprobación con un motivo.", status: 409, needsOverride: true };
    }
    if (blocked && !reason) return { error: "Escribe el motivo para aprobar pese a los bloqueos.", status: 400 };
    if (blocked && !allowOverride) return { error: "Este cliente no permite aprobar casos con bloqueos.", status: 409 };
    // Con excepción, cada validación sin resolver debe estar marcada como revisada.
    const open = validationsEnabled ? vals.filter((v) => v.ok === false && (v.severity === "block" || v.severity === "warn")) : [];
    if (blocked && open.some((v) => !acknowledged.has(v.id))) {
      return { error: "Marca como revisadas todas las validaciones sin resolver antes de aprobar con excepción.", status: 400 };
    }
    if (support) {
      const claimed = await tx.update(contractLargeUploads).set({ status: "claimed", claimedBy: id })
        .where(and(eq(contractLargeUploads.id, support.id), eq(contractLargeUploads.status, "completed"), isNull(contractLargeUploads.claimedBy)))
        .returning({ id: contractLargeUploads.id });
      if (claimed.length !== 1) return { error: "El soporte ya se usó en otro caso.", status: 409 };
    }

    const prev = (kase.resultJson ?? {}) as Record<string, unknown>;
    await tx.update(contractCases).set({
      status: "approved",
      resultJson: { ...prev, decision: {
        action: "approve", reason: reason || null, byId: session.sub, byEmail: session.email, at: new Date().toISOString(), override: blocked,
        ...(blocked ? { acknowledged: [...acknowledged] } : {}),
        ...(support ? { support: { storageKey: support.storageKey, name: support.originalName, mimeType: support.mimeType } } : {}),
      } },
      updatedAt: new Date(),
    }).where(eq(contractCases.id, id));
    return { blocked };
  });

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error, ...(outcome.needsOverride ? { needsOverride: true } : {}) }, { status: outcome.status });
  }

  await logAudit({ orgId: session.orgId, userId: session.sub, userEmail: session.email, action: "contract.approved", resourceType: "contract_case", resourceId: id, metadata: { override: outcome.blocked, reason: reason || null, acknowledged: outcome.blocked ? [...acknowledged] : undefined, support: support?.originalName ?? undefined } });
  return NextResponse.json({ ok: true, status: "approved" });
}

export const POST = withApiSecurity(handlePOST);
