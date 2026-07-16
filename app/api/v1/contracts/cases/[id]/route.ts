import { NextRequest, NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { contractCases, contractDocuments, contractValidations } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const kase = await db.query.contractCases.findFirst({
    where: and(eq(contractCases.id, id), eq(contractCases.organizationId, session.orgId)),
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const [documents, validations] = await Promise.all([
    db.query.contractDocuments.findMany({ where: eq(contractDocuments.caseId, id) }),
    db.query.contractValidations.findMany({ where: eq(contractValidations.caseId, id) }),
  ]);

  return NextResponse.json({ case: kase, documents, validations });
}
