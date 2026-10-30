import { withApiSecurity } from "@/lib/security/http";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { getTodayMonitor } from "@/lib/admin/monitor";

async function handleGET() {
  const { error } = await requireAdminSession();
  if (error) return error;
  try {
    return NextResponse.json(await getTodayMonitor());
  } catch (err) {
    console.error("[admin/metrics/today]", err);
    return NextResponse.json({ error: "No se pudo calcular el monitor" }, { status: 500 });
  }
}

export const GET = withApiSecurity(handleGET);
