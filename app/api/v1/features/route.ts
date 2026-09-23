import { withApiSecurity } from "@/lib/security/http";
import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { getAllFeatures } from "@/lib/features";

async function handleGET() {
  const session = await getTenantSession({ area: "profile" });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const resolved = await getAllFeatures(session.orgId);
  const features = Object.fromEntries(resolved.map(f => [f.id, f.isEnabled]));
  return NextResponse.json({ features });
}

export const GET = withApiSecurity(handleGET);
