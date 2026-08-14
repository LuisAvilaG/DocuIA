export interface CustomFormGroupConfig {
  id?: string;
  name?: string;
  subsidiary_ids?: string[];
  invoice_customform_id?: string;
  po_customform_id?: string;
}

export interface CustomFormsConfig {
  global?: {
    invoice_customform_id?: string;
    po_customform_id?: string;
  };
  groups?: CustomFormGroupConfig[];
  // Compatibilidad con tenants configurados antes de admitir grupos.
  invoice_customform_id?: string;
  po_customform_id?: string;
}

function formForDocument(config: Pick<CustomFormGroupConfig, "invoice_customform_id" | "po_customform_id">, documentType: string): string {
  return (documentType === "purchase_order" ? config.po_customform_id : config.invoice_customform_id)?.trim() ?? "";
}

/** El grupo de la subsidiaria prevalece sobre el formulario global. */
export function resolveCustomFormId(config: CustomFormsConfig | null | undefined, subsidiaryId: string, documentType: string): string {
  if (!config) return "";
  const group = config.groups?.find(entry => entry.subsidiary_ids?.includes(subsidiaryId));
  const groupForm = group ? formForDocument(group, documentType) : "";
  if (groupForm) return groupForm;

  const globalForm = config.global ? formForDocument(config.global, documentType) : "";
  if (globalForm) return globalForm;
  return formForDocument(config, documentType);
}

export function validateCustomFormsConfig(config: unknown, validSubsidiaryIds: Set<string>): string | null {
  if (!config || typeof config !== "object") return "La configuración de formularios no es válida.";
  const groups = (config as CustomFormsConfig).groups;
  if (groups === undefined) return null;
  if (!Array.isArray(groups)) return "Los grupos de formularios no son válidos.";

  const assigned = new Set<string>();
  for (const group of groups) {
    if (!group || typeof group !== "object" || !String(group.name ?? "").trim()) {
      return "Cada grupo de formularios necesita un nombre.";
    }
    if (!Array.isArray(group.subsidiary_ids) || group.subsidiary_ids.length === 0) {
      return `El grupo ${String(group.name)} necesita al menos una subsidiaria.`;
    }
    for (const subsidiaryId of group.subsidiary_ids) {
      if (!validSubsidiaryIds.has(subsidiaryId)) return "Una subsidiaria del grupo no pertenece a este tenant.";
      if (assigned.has(subsidiaryId)) return "Una subsidiaria solo puede pertenecer a un grupo de formularios.";
      assigned.add(subsidiaryId);
    }
  }
  return null;
}
