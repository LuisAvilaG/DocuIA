import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { runReceiptChecks } from "@/lib/workflow/receipt-check";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

// Re-checks invoices waiting for the goods receipt (3-way match) whose next
// check is due; each document keeps its own cadence (three_way_match config).
async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runReceiptChecks();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/receipt-check]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
