import { withApiSecurity } from "@/lib/security/http";
import { logAdminAction } from "@/lib/audit/admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { organizations, orgFeatures } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { setAdminGrant } from "@/lib/features";

type Params = { params: Promise<{ id: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { error, session } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const { environment } = await req.json();

    if (!["sandbox", "production"].includes(environment)) {
      return NextResponse.json({ error: "environment must be sandbox or production" }, { status: 400 });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      with: { nsConnections: true },
    });

    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

    const hasConnection = org.nsConnections?.some(
      (c) => c.environment === environment && c.connectionStatus === "connected",
    );

    if (!hasConnection) {
      return NextResponse.json(
        { error: `No connected ${environment} NS account found for this organization` },
        { status: 422 },
      );
    }

    await db.update(organizations)
      .set({ activeNsEnvironment: environment, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));

    await logAdminAction(req, session!, {
      action: "environment.switched", targetOrgId: organizationId, targetOrgName: org.name,
      before: { environment: org.activeNsEnvironment }, after: { environment },
    });

    // El modo QA nunca convive con producción: se apaga solo y queda auditado.
    if (environment === "production") {
      const qa = await db.query.orgFeatures.findFirst({
        where: and(eq(orgFeatures.organizationId, organizationId), eq(orgFeatures.featureId, "qa_mode")),
        columns: { adminGranted: true, configJson: true, notes: true },
      });
      if (qa?.adminGranted) {
        await setAdminGrant(organizationId, "qa_mode", false, (qa.configJson ?? undefined) as Record<string, unknown> | undefined, session!.sub, qa.notes ?? undefined);
        await logAdminAction(req, session!, {
          action: "feature.auto_disabled", targetOrgId: organizationId, targetOrgName: org.name, targetFeature: "qa_mode",
          before: { adminGranted: true }, after: { adminGranted: false, reason: "environment_production" },
        });
      }
    }
    return NextResponse.json({ ok: true, activeNsEnvironment: environment });
  } catch (err) {
    console.error("[clients/environment PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const PATCH = withApiSecurity(handlePATCH);
