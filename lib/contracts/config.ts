import { db } from "@/lib/db";
import { contractDocTypes, contractFieldSchemas } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import type { DocTypeOption, FieldDef } from "./extract";

export interface ContractConfig {
  docTypes:     DocTypeOption[];
  fieldsByType: Record<string, FieldDef[]>;
}

// Generic fallback so a case can always be processed even before a playbook is
// configured for the org (P12 lets clients customize this).
const GENERIC_CONFIG: ContractConfig = {
  docTypes: [{ key: "contract", name: "Contrato", hint: "acuerdo entre partes" }],
  fieldsByType: {
    contract: [
      { fieldKey: "parties",     label: "Partes",              isList: true },
      { fieldKey: "object",      label: "Objeto del contrato", isList: false },
      { fieldKey: "amount",      label: "Monto",               isList: false },
      { fieldKey: "start_date",  label: "Fecha de inicio",     isList: false },
      { fieldKey: "end_date",    label: "Fecha de término",    isList: false },
      { fieldKey: "signatories", label: "Firmantes",           isList: true },
    ],
  },
};

export async function getContractConfig(orgId: string): Promise<ContractConfig> {
  const [types, fields] = await Promise.all([
    db.query.contractDocTypes.findMany({
      where: and(eq(contractDocTypes.organizationId, orgId), eq(contractDocTypes.isActive, true)),
      orderBy: [asc(contractDocTypes.sortOrder)],
    }),
    db.query.contractFieldSchemas.findMany({
      where: eq(contractFieldSchemas.organizationId, orgId),
      orderBy: [asc(contractFieldSchemas.sortOrder)],
    }),
  ]);

  if (types.length === 0) return GENERIC_CONFIG;

  const fieldsByType: Record<string, FieldDef[]> = {};
  for (const f of fields) {
    (fieldsByType[f.docTypeKey] ??= []).push({ fieldKey: f.fieldKey, label: f.label, isList: f.isList });
  }
  // Any configured type without fields falls back to the generic contract fields.
  for (const t of types) if (!fieldsByType[t.key]) fieldsByType[t.key] = GENERIC_CONFIG.fieldsByType.contract;

  return {
    docTypes: types.map((t) => ({ key: t.key, name: t.name, hint: t.classificationHint })),
    fieldsByType,
  };
}
