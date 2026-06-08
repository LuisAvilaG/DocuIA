import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
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

    return NextResponse.json({ ok: true, activeNsEnvironment: environment });
  } catch (err) {
    console.error("[clients/environment PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
