import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { probeCatalogScript } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";

export async function POST(req: NextRequest) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const body = await req.json();
    const { accountId, consumerKey, consumerSecret, tokenId, tokenSecret, catalogScriptId, catalogDeployId } = body;

    if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      return NextResponse.json({ error: "TBA credentials are required" }, { status: 400 });
    }
    if (!catalogScriptId || !catalogDeployId) {
      return NextResponse.json({ error: "catalogScriptId and catalogDeployId are required" }, { status: 400 });
    }

    const creds: NSCredentials = { accountId, consumerKey, consumerSecret, tokenId, tokenSecret };
    const result = await probeCatalogScript(creds, catalogScriptId, catalogDeployId);

    return NextResponse.json({ ok: result.ok, version: result.data?.version, error: result.error });
  } catch (err) {
    console.error("[ns/probe-scripts]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
