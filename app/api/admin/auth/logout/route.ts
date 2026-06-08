import { NextRequest, NextResponse } from "next/server";
import { verifyRefreshToken } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { authSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get("admin_refresh_token")?.value;

  if (refreshCookie) {
    try {
      const { sessionId } = await verifyRefreshToken(refreshCookie);
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, sessionId));
    } catch { /* token invalid — still clear cookies */ }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete("admin_access_token");
  res.cookies.delete("admin_refresh_token");
  return res;
}
