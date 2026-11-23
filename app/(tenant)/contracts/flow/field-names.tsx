"use client";

import { createContext, useContext } from "react";

/** Visible name of each extracted field: document type → field key → name. */
export type FieldNames = Record<string, Record<string, string>>;

// The stage forms store the key of a field, but a person choosing one should
// read the name they gave it ("Número del contrato"), not "numero_contrato".
export const FieldNamesContext = createContext<FieldNames>({});

/** The name to show for a field; its key when it has no name yet. */
export function useFieldName(): (docType: string, key: string) => string {
  const names = useContext(FieldNamesContext);
  return (docType, key) => names[docType]?.[key]?.trim() || key;
}
