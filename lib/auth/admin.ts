import { NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "./jwt";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function requireAdminSession() {
  const session = await getAdminSessionFromCookies();
  if (!session || session.type !== "platform_admin") {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // A signed access token alone is not enough: the account can have been
  // disabled after the token was issued. Check the authoritative account
  // state before granting access to every platform-admin API route.
  const admin = await db.query.platformAdmins.findFirst({
    where: and(eq(platformAdmins.id, session.sub), eq(platformAdmins.isActive, true)),
    columns: { id: true },
  });
  if (!admin) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { session, error: null };
}
