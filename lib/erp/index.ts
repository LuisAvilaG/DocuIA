// The one place that knows which ERP a client uses. Flows ask for the client's
// adapter here and never touch an ERP's own client code.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { nsConnections, organizations } from "@/db/schema";
import type { NsConnection } from "@/lib/netsuite/connection";
import { netsuiteAdapter, NETSUITE_CAPABILITIES } from "./netsuite";
import { ERP_PROVIDER_IDS, type ErpAdapter, type ErpCapabilities, type ErpProviderId } from "./types";

export type { ErpAdapter, ErpCapabilities, ErpProviderId, ErpPostResult, ErpResult } from "./types";

interface ErpProvider {
  label: string;
  capabilities: ErpCapabilities;
  /** Builds the adapter from the client's stored connection. */
  connect: (connection: NsConnection) => ErpAdapter;
}

/** Every ERP DocuIA can talk to. A new one is added here, with its adapter. */
export const ERP_PROVIDERS: Record<ErpProviderId, ErpProvider> = {
  netsuite: { label: "NetSuite", capabilities: NETSUITE_CAPABILITIES, connect: netsuiteAdapter },
};

export function isErpProvider(value: unknown): value is ErpProviderId {
  return typeof value === "string" && (ERP_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The provider written on a connection; connections from before the column existed are NetSuite. */
export function providerOf(connection: { provider?: string | null }): ErpProviderId {
  return isErpProvider(connection.provider) ? connection.provider : "netsuite";
}

function adapterFor(connection: NsConnection): ErpAdapter {
  return ERP_PROVIDERS[providerOf(connection)].connect(connection);
}

/**
 * The client's ERP for its active environment, or null when it has none
 * connected. Sandbox and production rows can both exist: the organization says
 * which one is in use, so catalogs are never read from one and documents
 * posted to the other.
 */
export async function getErp(organizationId: string, options: { includeInactive?: boolean } = {}): Promise<ErpAdapter | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { activeNsEnvironment: true },
  });
  if (!org) return null;
  const environment = org.activeNsEnvironment === "production" ? "production" : "sandbox";
  const connection = await db.query.nsConnections.findFirst({
    where: and(
      eq(nsConnections.organizationId, organizationId),
      eq(nsConnections.environment, environment),
      options.includeInactive ? undefined : eq(nsConnections.isActive, true),
    ),
  });
  return connection ? adapterFor(connection) : null;
}

/** Same, for flows that cannot go on without an ERP. */
export async function requireErp(organizationId: string): Promise<ErpAdapter> {
  const erp = await getErp(organizationId);
  if (!erp) throw new Error("No hay conexión activa con el ERP");
  return erp;
}

/** The expense side of the client's ERP; null when it has no ERP or its ERP does not do expenses. */
export async function getErpExpenses(organizationId: string) {
  return (await getErp(organizationId))?.expenses ?? null;
}

/** Sends an approved expense report to the client's ERP. */
export async function postExpenseReport(reportId: string, organizationId: string) {
  const erp = await requireErp(organizationId);
  if (!erp.expenses) throw new Error(`${erp.label} no tiene habilitado el envío de informes de gastos desde DocuIA`);
  return erp.expenses.postReport(reportId, organizationId);
}

/** Name of the client's ERP for texts ("NetSuite"); "el ERP" when it has none connected. */
export async function erpLabel(organizationId: string): Promise<string> {
  return (await getErp(organizationId, { includeInactive: true }))?.label ?? "el ERP";
}
