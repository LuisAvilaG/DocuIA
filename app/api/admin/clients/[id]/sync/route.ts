import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { syncSubsidiaryCatalog, type CatalogType } from "@/lib/netsuite/sync-catalog";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();
    const { subsidiaryId, types } = body as { subsidiaryId: string; types?: CatalogType[] };

    if (!subsidiaryId) {
      return NextResponse.json({ error: "subsidiaryId is required" }, { status: 400 });
    }

    const result = await syncSubsidiaryCatalog(organizationId, subsidiaryId, types);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, partial: result.partial }, { status: result.status });
    }
    return NextResponse.json({ ok: true, summary: result.summary });
  } catch (err) {
    console.error("[clients/sync POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
