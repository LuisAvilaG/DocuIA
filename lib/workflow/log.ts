import { db } from "@/lib/db";
import { workflowRuntimeLogs } from "@/db/schema";

export type LogEntry = {
  organizationId: string;
  requestId?: string;
  stage?: string;
  step?: string;
  status: "STARTED" | "INFO" | "SUCCESS" | "FAILED";
  model?: string;
  engine?: string;
  documentType?: string;
  vendor?: string;
  invoiceNumber?: string;
  lineCount?: number;
  durationMs?: number;
  httpStatus?: number;
  fallbackUsed?: boolean;
  metaJson?: Record<string, unknown>;
  errorMessage?: string;
};

export async function logWorkflow(entry: LogEntry): Promise<void> {
  try {
    await db.insert(workflowRuntimeLogs).values({
      organizationId: entry.organizationId,
      requestId: entry.requestId ?? null,
      stage: entry.stage ?? null,
      step: entry.step ?? null,
      status: entry.status,
      model: entry.model ?? null,
      engine: entry.engine ?? null,
      documentType: entry.documentType ?? null,
      vendor: entry.vendor ?? null,
      invoiceNumber: entry.invoiceNumber ?? null,
      lineCount: entry.lineCount ?? null,
      durationMs: entry.durationMs ?? null,
      httpStatus: entry.httpStatus ?? null,
      fallbackUsed: entry.fallbackUsed ?? false,
      metaJson: entry.metaJson ?? null,
      errorMessage: entry.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[log] Failed to write workflow log:", err);
  }
}
