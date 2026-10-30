import { AdminLayoutClient } from "@/components/admin/admin-layout-client";
import { getAdminSessionFromCookies } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { initials } from "@/components/admin/ui";

// Admin pages are session-gated and read live data from the DB per request;
// never prerender them at build (avoids build-time DB calls + stale HTML).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSessionFromCookies();
  let label = "?";
  if (session) {
    const admin = await db.query.platformAdmins.findFirst({ where: eq(platformAdmins.id, session.sub), columns: { fullName: true, email: true } }).catch(() => null);
    label = initials(admin?.fullName || admin?.email || session.email || "?");
  }
  return <AdminLayoutClient adminInitials={label}>{children}</AdminLayoutClient>;
}
