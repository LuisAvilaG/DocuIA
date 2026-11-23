import { withApiSecurity } from "@/lib/security/http";
import { NextRequest, NextResponse } from "next/server";
import { sweepQaMode } from "@/lib/features/qa-mode-sweep";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

// Apaga el modo QA vencido o de clientes cuyo ERP ya no está en sandbox.
async function handleGET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await sweepQaMode();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/qa-mode]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
