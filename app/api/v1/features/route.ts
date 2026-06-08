import { NextResponse } from "next/server";
import { getTenantSession } from "@/lib/auth/jwt";
import { getAllFeatures } from "@/lib/features";

export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const resolved = await getAllFeatures(session.orgId);
  const features = Object.fromEntries(resolved.map(f => [f.id, f.isEnabled]));
  return NextResponse.json({ features });
}
