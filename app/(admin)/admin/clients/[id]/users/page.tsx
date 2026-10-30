import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgUsers, organizations } from "@/db/schema";
import { UsersView } from "./users-view";

export default async function ClientUsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id), columns: { id: true } });
  if (!org) notFound();
  const users = await db.query.orgUsers.findMany({
    where: eq(orgUsers.organizationId, id),
    columns: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: [asc(orgUsers.createdAt)],
  });
  return (
    <UsersView
      orgId={id}
      users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
    />
  );
}
