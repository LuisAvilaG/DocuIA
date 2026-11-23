// NetSuite as an ErpAdapter. Everything NetSuite-specific that the flows need
// is reached from here: token-based credentials, the two RESTlets installed in
// the client's account (catalog and process) and the record links.
import {
  fetchCatalogPage, fetchNsSubsidiaries, fetchOpenPurchaseOrders, fetchPurchaseOrderLines, testNsCredentials,
} from "@/lib/netsuite/client";
import { nsCredentials, type NsConnection } from "@/lib/netsuite/connection";
import { netsuiteRecordUrl, postToNetSuite } from "@/lib/workflow/process-ns";
import { syncClasses, syncDepartments, syncEmployees, syncExpenseCategories } from "@/lib/expense/sync-catalogs";
import { syncReportToNetsuite } from "@/lib/expense/sync-to-netsuite";
import type { ErpAdapter, ErpCapabilities } from "./types";

export const NETSUITE_CAPABILITIES: ErpCapabilities = {
  purchaseOrders: true,
  receipts: true,
  dryRun: true,
  customForms: true,
  attachments: true,
  expenses: true,
  environments: ["sandbox", "production"],
};

const NO_CATALOG_SCRIPT = { ok: false as const, error: "El script de catálogo del ERP no está configurado en la conexión", status: 422 };

export function netsuiteAdapter(conn: NsConnection): ErpAdapter {
  // Credentials are decrypted only when a call is made.
  const creds = () => nsCredentials(conn);
  const catalog = () => (conn.catalogScriptId && conn.catalogDeployId ? { scriptId: conn.catalogScriptId, deployId: conn.catalogDeployId } : null);

  return {
    provider: "netsuite",
    label: "NetSuite",
    environment: conn.environment === "production" ? "production" : "sandbox",
    capabilities: NETSUITE_CAPABILITIES,

    testConnection: () => testNsCredentials(creds()),

    async listCompanyUnits() {
      const script = catalog();
      return script ? fetchNsSubsidiaries(creds(), script.scriptId, script.deployId) : NO_CATALOG_SCRIPT;
    },

    async fetchCatalogPage(type, unitId, pageIndex, options = {}) {
      const script = catalog();
      if (!script) return NO_CATALOG_SCRIPT;
      return fetchCatalogPage(creds(), script.scriptId, script.deployId, type, unitId, pageIndex, options.pageSize ?? 500, options.timeoutMs, options.serviceCategoryId);
    },

    async fetchOpenPurchaseOrders(unitId, vendorId) {
      const script = catalog();
      return script ? fetchOpenPurchaseOrders(creds(), script.scriptId, script.deployId, unitId, vendorId) : NO_CATALOG_SCRIPT;
    },

    async fetchPurchaseOrderLines(poIds) {
      const script = catalog();
      return script ? fetchPurchaseOrderLines(creds(), script.scriptId, script.deployId, poIds) : NO_CATALOG_SCRIPT;
    },

    postDocument: (payload) => postToNetSuite(conn, payload),

    recordUrl: (documentType, internalId) => (conn.accountId && internalId ? netsuiteRecordUrl(documentType, conn.accountId, internalId) : null),

    expenses: {
      syncCategories: (organizationId, unitId) => syncExpenseCategories(organizationId, unitId, creds()),
      syncDepartments: (organizationId, unitId) => syncDepartments(organizationId, unitId, creds()),
      syncClasses: (organizationId, unitId) => syncClasses(organizationId, unitId, creds()),
      syncEmployees: (organizationId) => syncEmployees(organizationId, creds()),
      postReport: (reportId, organizationId) => syncReportToNetsuite(reportId, organizationId),
    },
  };
}
