export type BBox = {
  page: number;
  x1: number; y1: number;
  x2: number; y2: number;
};

export type ExtractedLine = {
  description: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  uom: string | null;
  itemCode: string | null;
  bbox?: BBox;
};

export type ExtractedInvoice = {
  format: "general" | "baldor" | "performance";
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  purchaseOrder: string;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lines: ExtractedLine[];
};

export type ItemOption = {
  internal_id: string;
  itemid: string;
  name: string;
  type: string;
  unit: string;
  unit_id: string | null;
  unit_ids: string[];
  unit_names: string[];
  _score: number;
  memory_source?: boolean;
};

export type VendorOption = {
  internal_id: string;
  name: string;
  entityid: string;
};

export type LocationOption = {
  internal_id: string;
  name: string;
};

export type MatchedLine = {
  line_no: number;
  description: string;
  item_code: string;
  quantity: number;
  rate: number | null;
  amount: number | null;
  uom: string | null;
  candidates: ItemOption[];
  selected_item_id: string | null;
  selected_unit_id: string | null;
  match_status: "FOUND_SINGLE" | "FOUND_MULTIPLE" | "NOT_FOUND";
  recommendation_source: "catalog" | "memory";
  recommendation_confidence: number | null;
  confidence: number;
  bbox?: BBox;
};

export type ExtractionResult = {
  invoice: ExtractedInvoice;
  model: string;
  fallbackUsed: boolean;
  rawJson: string;
  promptTokens: number;
  completionTokens: number;
};

export type UiPayload = {
  ok: boolean;
  type: "invoice_extraction";
  engine: string;
  format: string;
  generated_at: string;
  confidence: {
    header: number;
    lines: number;
    overall: number;
  };
  document: {
    vendor: {
      name: string | null;
      options: VendorOption[];
      selected_internal_id: string | null;
    };
    invoice_number: string | null;
    invoice_date: string;
    due_date: string | null;
    purchase_order: string | null;
    currency: string;
    totals: {
      subtotal: string | null;
      tax: string;
      total: string;
    };
    lines: MatchedLine[];
  };
  catalogs: {
    vendors: VendorOption[];
    locations: LocationOption[];
  };
  meta: Record<string, unknown>;
};
