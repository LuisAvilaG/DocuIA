import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTenantSession } from "@/lib/auth/jwt";
import { isProductActive } from "@/lib/products";
import { isFeatureEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { approvalMaps, orgUsers } from "@/db/schema";
import { approvalEditorContext } from "@/lib/approval-map/admin";
import { rolesInMap } from "@/lib/approval-map/roles";
import { RolesClient, type RoleRow } from "./roles-client";

export default async function ApprovalRolesPage() {
  const session = await getTenantSession({ area: "contracts" });
  if (!session) redirect("/login");
  if (!(await isProductActive(session.orgId, "contract_intelligence"))) redirect("/dashboard");
  if (!(await isFeatureEnabled(session.orgId, "contract_approval_rules"))) redirect("/contracts/dashboard");
  if (session.role !== "admin") redirect("/cases");

  const [ctx, maps, users] = await Promise.all([
    approvalEditorContext(session.orgId),
    db.query.approvalMaps.findMany({ where: eq(approvalMaps.organizationId, session.orgId), columns: { draftJson: true, publishedJson: true } }),
    db.query.orgUsers.findMany({ where: eq(orgUsers.organizationId, session.orgId), columns: { id: true, fullName: true, email: true } }),
  ]);
  const used = maps.map((m) => new Set([...rolesInMap(m.draftJson), ...rolesInMap(m.publishedJson)]));
  const allNames = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const signers = new Set(ctx.people.map((p) => p.id));

  const roles: RoleRow[] = ctx.roles.map((r) => ({
    ...r,
    mapCount: used.filter((ids) => ids.has(r.id)).length,
  }));
  // Quien está en un rol pero ya no puede aprobar (inactivo o con otro rol) se muestra con su nombre.
  const formerIds = new Set(ctx.roles.flatMap((r) => [...r.memberIds, ...(r.substituteId ? [r.substituteId] : [])]).filter((id) => !signers.has(id)));
  const formerNames = Object.fromEntries([...formerIds].map((id) => [id, allNames.get(id) ?? "Usuario eliminado"]));

  return <RolesClient people={ctx.people} roles={roles} absences={ctx.absences} today={ctx.today} formerNames={formerNames} />;
}
