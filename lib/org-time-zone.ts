import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { safeTimeZone } from "@/lib/time-zone";

/** The client's time zone, for dates shown or grouped on the server. */
export async function orgTimeZone(organizationId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId), columns: { timezone: true } });
  return safeTimeZone(org?.timezone);
}
