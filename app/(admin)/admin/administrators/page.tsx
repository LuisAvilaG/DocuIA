import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { requireAdminSession } from "@/lib/auth/admin";
import { PlatformAdminsClient } from "@/components/admin/platform-admins-client";
import { db } from "@/lib/db";
import { platformAdmins } from "@/db/schema";

export default async function PlatformAdministratorsPage() {
  const { error, session } = await requireAdminSession();
  if (error) redirect("/admin/login");

  const admins = await db
    .select({
      id: platformAdmins.id,
      email: platformAdmins.email,
      fullName: platformAdmins.fullName,
      isActive: platformAdmins.isActive,
      lastLoginAt: platformAdmins.lastLoginAt,
      createdAt: platformAdmins.createdAt,
      updatedAt: platformAdmins.updatedAt,
    })
    .from(platformAdmins)
    .orderBy(desc(platformAdmins.createdAt));

  return <PlatformAdminsClient initialAdmins={admins} currentAdminId={session!.sub} />;
}
