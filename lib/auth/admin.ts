import { NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "./jwt";

export async function requireAdminSession() {
  const session = await getAdminSessionFromCookies();
  if (!session || session.type !== "platform_admin") {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, error: null };
}
