import { findingLevel } from "@/lib/contracts/validate";
import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases, contractValidations } from "@/db/schema";

/** Validaciones sin resolver del caso (bloqueos y por revisar): la lista que se marca al aprobar con excepción. */
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({ where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)), columns: { id: true } });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  const rows = await db.select({ id: contractValidations.id, ok: contractValidations.ok, severity: contractValidations.severity, ruleName: contractValidations.ruleName, subject: contractValidations.subject, reason: contractValidations.reason })
    .from(contractValidations)
    .where(and(eq(contractValidations.caseId, id), or(eq(contractValidations.ok, false), isNull(contractValidations.ok)), inArray(contractValidations.severity, ["block", "warn"])));
  // Un bloqueante sin verificar se muestra como «a revisar».
  const findings = rows.map(({ ok, ...r }) => ({ ...r, severity: findingLevel({ ok, severity: r.severity }) ?? "warn" }));
  return NextResponse.json({ findings: findings.sort((a, b) => (a.severity === "block" ? 0 : 1) - (b.severity === "block" ? 0 : 1)) });
}

export const GET = withApiSecurity(handleGET);
