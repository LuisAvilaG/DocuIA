import { db } from "@/lib/db";
import { nsConnections, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptField } from "@/lib/crypto/encrypt";
import type { NSCredentials } from "./oauth";

export type NsConnection = typeof nsConnections.$inferSelect;

/**
 * The connection for the organization's active environment. Sandbox and
 * production rows can both be active; picking "any active row" let catalog
 * sync or PO lookups read one account while documents posted to the other.
 */
export async function getActiveNsConnection(organizationId: string): Promise<NsConnection | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { activeNsEnvironment: true },
  });
  if (!org) return null;
  const environment = org.activeNsEnvironment === "production" ? "production" : "sandbox";
  const conn = await db.query.nsConnections.findFirst({
    where: and(
      eq(nsConnections.organizationId, organizationId),
      eq(nsConnections.environment, environment),
      eq(nsConnections.isActive, true),
    ),
  });
  return conn ?? null;
}

export function nsCredentials(conn: NsConnection): NSCredentials {
  return {
    accountId:      conn.accountId,
    consumerKey:    decryptField(conn.consumerKey),
    consumerSecret: decryptField(conn.consumerSecret),
    tokenId:        decryptField(conn.tokenId),
    tokenSecret:    decryptField(conn.tokenSecret),
  };
}
