// What DocuIA needs from a client's ERP, whichever it is. Every flow (reading
// catalogs, comparing an invoice with its purchase order, posting a document,
// expenses) goes through an ErpAdapter; the rest of the app does not know which
// ERP is on the other side. NetSuite is the first adapter (lib/erp/netsuite.ts);
// adding another ERP means writing one more and registering it (docs/ERP.md).
//
// The data shapes below are the ones the first adapter produced. They are the
// contract: a new adapter maps its ERP's records to them.
import type {
  NSCatalogItem, NSLocation, NSOpenPurchaseOrder, NSPagedResult,
  NSPurchaseOrderDetail, NSPurchaseOrderLine, NSRestletResult, NSSubsidiary, NSVendor,
} from "@/lib/netsuite/client";

/** Every ERP that has an adapter. A client's connection says which one it uses. */
export const ERP_PROVIDER_IDS = ["netsuite"] as const;
export type ErpProviderId = (typeof ERP_PROVIDER_IDS)[number];

export type ErpEnvironment = "sandbox" | "production";

/** The answer of any call to the ERP: either the data or why not. */
export type ErpResult<T> = NSRestletResult<T>;

/** A company / legal entity inside the ERP (NetSuite: subsidiary; SAP: company code). */
export type ErpCompanyUnit = NSSubsidiary;
export type ErpCatalogItem = NSCatalogItem;
export type ErpVendor = NSVendor;
export type ErpLocation = NSLocation;
export type ErpCatalogType = "items" | "vendors" | "locations";
export type ErpCatalogPage = NSPagedResult<ErpCatalogItem | ErpVendor | ErpLocation>;
export type ErpOpenPurchaseOrder = NSOpenPurchaseOrder;
export type ErpPurchaseOrderLine = NSPurchaseOrderLine;
export type ErpPurchaseOrder = NSPurchaseOrderDetail;

/** What happened when a document was sent to the ERP. */
export interface ErpPostResult {
  ok: boolean;
  /** Id of the record in the ERP; null on a dry run. */
  internalId: string | null;
  /** Link to open the record in the ERP, when the ERP has one. */
  recordUrl: string | null;
  error: string | null;
  /** Things the ERP did differently from what was asked, in words for the user. */
  warnings: string[];
  /** The ERP's own answer, kept for diagnosis. */
  nsResponse: Record<string, unknown>;
}

/**
 * What an ERP can do. Screens and flows ask here instead of assuming: a
 * feature that needs something the client's ERP does not offer is shown as not
 * available, not left as a switch that does nothing.
 */
export interface ErpCapabilities {
  /** Open purchase orders can be listed and compared line by line. */
  purchaseOrders: boolean;
  /** The purchase order says how much of each line was received. */
  receipts: boolean;
  /** A document can be validated without saving it. */
  dryRun: boolean;
  /** Bills can be saved with a form / layout chosen per company unit. */
  customForms: boolean;
  /** Files (XML, PDF) and extra fields can travel with the bill. */
  attachments: boolean;
  /** Expense reports and their catalogs (categories, employees). */
  expenses: boolean;
  /** Environments a client can have connected at once. */
  environments: readonly ErpEnvironment[];
}

/** What came of sending an expense report: the report's record and each line's. */
export interface ErpExpensePostResult {
  ok: boolean;
  nsExpenseReportId: string | null;
  itemResults: Array<{ itemId: string; nsRecordId: string | null; error: string | null }>;
  errors: string[];
}

/** Expenses, for the ERPs that support them (capabilities.expenses). */
export interface ErpExpenses {
  /** Each reads one catalog from the ERP into DocuIA and reports what changed. */
  syncCategories(organizationId: string, unitId: string | null): Promise<unknown>;
  syncDepartments(organizationId: string, unitId: string | null): Promise<unknown>;
  syncClasses(organizationId: string, unitId: string | null): Promise<unknown>;
  syncEmployees(organizationId: string): Promise<unknown>;
  /** Sends an approved report: personal expenses and bills paid by the company. */
  postReport(reportId: string, organizationId: string): Promise<ErpExpensePostResult>;
}

export interface ErpAdapter {
  readonly provider: ErpProviderId;
  /** Name shown to people: "NetSuite". */
  readonly label: string;
  readonly environment: ErpEnvironment;
  readonly capabilities: ErpCapabilities;

  /** Whether the stored credentials still open the ERP. */
  testConnection(): Promise<ErpResult<{ accountId: string }>>;
  /** The company units the connection can see. */
  listCompanyUnits(): Promise<ErpResult<ErpCompanyUnit[]>>;
  /** One page of a catalog of a company unit. */
  fetchCatalogPage(type: ErpCatalogType, unitId: string, pageIndex: number, options?: { pageSize?: number; timeoutMs?: number; serviceCategoryId?: string }): Promise<ErpResult<ErpCatalogPage>>;
  /** Purchase orders of a vendor that can still be billed. */
  fetchOpenPurchaseOrders(unitId: string, vendorId: string): Promise<ErpResult<ErpOpenPurchaseOrder[]>>;
  /** Lines of the given purchase orders, with what was received and billed. */
  fetchPurchaseOrderLines(poIds: string[]): Promise<ErpResult<ErpPurchaseOrder[]>>;
  /**
   * Sends a document (vendor bill or purchase order). `payload` is the neutral
   * request built by lib/workflow/ns-payload.ts: vendor, number, dates,
   * currency, lines, the purchase order it bills and `dry_run`.
   */
  postDocument(payload: Record<string, unknown>): Promise<ErpPostResult>;
  /** Link to a record that was posted earlier, or null when it cannot be built. */
  recordUrl(documentType: string, internalId: string): string | null;
  /** Present only when the ERP handles expenses. */
  readonly expenses?: ErpExpenses;
}
