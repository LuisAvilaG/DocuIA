import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { testNsCredentials } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";

export async function POST(req: NextRequest) {
  const { error } = await requireAdminSession();
  if (error) return error;

  try {
    const body = await req.json();
    const { accountId, consumerKey, consumerSecret, tokenId, tokenSecret } = body;

    if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      return NextResponse.json({ error: "All TBA credentials are required" }, { status: 400 });
    }

    const creds: NSCredentials = { accountId, consumerKey, consumerSecret, tokenId, tokenSecret };
    const result = await testNsCredentials(creds);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }

    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    console.error("[ns/test-connection]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
