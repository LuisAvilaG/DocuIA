import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { contractDocTypes, contractFieldSchemas, contractValidationRules, contractOutputTemplates, contractFlows } from "@/db/schema";
import { presetToFlow } from "./flow";

// A playbook preset: doc types, extraction fields, validation rules and an
// output template that turn the generic engine into a working vertical.
// Clients pick a preset at onboarding; it's cloned into their org and editable.
export interface ContractPreset {
  key: string;
  name: string;
  docTypes: Array<{ key: string; name: string; hint?: string; fields: Array<{ key: string; label: string; isList?: boolean }> }>;
  rules: Array<{ name: string; appliesTo: string; conditions: unknown }>;
  template: { key: string; name: string; body: string };
}

// ── Seguros de Garantía (Chile) ───────────────────────────────────────
export const SEGUROS_GARANTIA_CL: ContractPreset = {
  key: "seguros_garantia_cl",
  name: "Seguros de Garantía (Chile)",
  docTypes: [
    { key: "contrato", name: "Contrato", hint: "acuerdo comercial o de obra entre la sociedad y un tercero", fields: [
      { key: "contratante", label: "Contratante" },
      { key: "rut_contratante", label: "RUT contratante" },
      { key: "representantes", label: "Representantes", isList: true },
      { key: "objeto", label: "Objeto" },
      { key: "monto_uf", label: "Monto (UF)" },
      { key: "vigencia", label: "Vigencia" },
      { key: "forma_pago", label: "Forma de pago" },
      { key: "tipo_contrato", label: "Tipo de contrato" },
      { key: "clausulas_relevantes", label: "Cláusulas relevantes", isList: true },
    ]},
    { key: "escritura_poderes", name: "Escritura de poderes", hint: "constitución, estatutos, poderes, designación de administradores", fields: [
      { key: "sociedad", label: "Sociedad" },
      { key: "apoderados", label: "Apoderados", isList: true },
      { key: "forma_actuacion", label: "Forma de actuación" },
      { key: "notaria", label: "Notaría" },
      { key: "fecha", label: "Fecha" },
      { key: "repertorio", label: "Repertorio" },
    ]},
    { key: "certificado_vigencia", name: "Certificado de vigencia", hint: "certificado del Conservador que acredita vigencia de la sociedad o poderes", fields: [
      { key: "sociedad", label: "Sociedad" },
      { key: "personas_cubiertas", label: "Personas cubiertas", isList: true },
      { key: "inscripcion", label: "Inscripción" },
      { key: "fecha_corte", label: "Fecha de corte" },
      { key: "revocado", label: "Revocado" },
    ]},
  ],
  rules: [{
    name: "Validación de firmantes",
    appliesTo: "signer",
    conditions: {
      kind: "cross_reference",
      subjects: { docType: "contrato", field: "representantes" },
      membership: { docType: "escritura_poderes", field: "apoderados", label: "En escritura de poderes" },
      confirmation: { docType: "certificado_vigencia", field: "revocado", label: "Poder vigente (certificado)" },
      statusLabels: { pass: "vigente", fail: "no_vigente", unknown: "indeterminado" },
    },
  }],
  template: {
    key: "cotizacion_seguro_garantia",
    name: "Cotización de seguro de garantía",
    body: [
      "COTIZACIÓN DE SEGURO DE GARANTÍA",
      "",
      "Aviso Art. 583 Código de Comercio: seguro a primer requerimiento; la insolvencia del afianzado no es causal de siniestro.",
      "",
      "Contratante-Afianzado: {{contratante}}",
      "RUT: {{rut_contratante}}",
      "Objeto / Obra: {{objeto}}",
      "Monto asegurado: {{monto_uf}} UF",
      "Vigencia: {{vigencia}}",
      "Forma de pago: {{forma_pago}}",
      "",
      "Representantes del contrato: {{representantes}}",
      "Apoderados (escritura): {{apoderados}}",
      "",
      "VALIDACIÓN DE FIRMANTES:",
      "{{_validations}}",
      "",
      "Contragarantía: [POR COMPLETAR]",
      "Confidencialidad: la presente cotización es confidencial.",
      "Validez de la oferta: 30 días.",
    ].join("\n"),
  },
};

export const PRESETS: Record<string, ContractPreset> = {
  [SEGUROS_GARANTIA_CL.key]: SEGUROS_GARANTIA_CL,
};

// Clone a preset into an org (idempotent). Safe to call at onboarding.
export async function seedContractPreset(orgId: string, presetKey = SEGUROS_GARANTIA_CL.key): Promise<void> {
  const preset = PRESETS[presetKey];
  if (!preset) throw new Error(`Preset desconocido: ${presetKey}`);

  for (let i = 0; i < preset.docTypes.length; i++) {
    const dt = preset.docTypes[i];
    await db.insert(contractDocTypes).values({
      organizationId: orgId, key: dt.key, name: dt.name, classificationHint: dt.hint ?? null, sortOrder: i,
    }).onConflictDoNothing({ target: [contractDocTypes.organizationId, contractDocTypes.key] });

    for (let j = 0; j < dt.fields.length; j++) {
      const f = dt.fields[j];
      await db.insert(contractFieldSchemas).values({
        organizationId: orgId, docTypeKey: dt.key, fieldKey: f.key, label: f.label,
        fieldType: f.isList ? "list" : "string", isList: !!f.isList, sortOrder: j,
      }).onConflictDoNothing({ target: [contractFieldSchemas.organizationId, contractFieldSchemas.docTypeKey, contractFieldSchemas.fieldKey] });
    }
  }

  for (let i = 0; i < preset.rules.length; i++) {
    const r = preset.rules[i];
    // Rules have no natural unique key; only seed if none exist yet for the org.
    const existing = await db.query.contractValidationRules.findFirst({
      where: (t, { eq }) => eq(t.organizationId, orgId),
    });
    if (!existing) {
      await db.insert(contractValidationRules).values({
        organizationId: orgId, name: r.name, appliesTo: r.appliesTo, conditionsJson: r.conditions, sortOrder: i,
      });
    }
  }

  await db.insert(contractOutputTemplates).values({
    organizationId: orgId, key: preset.template.key, name: preset.template.name, body: preset.template.body,
  }).onConflictDoNothing({ target: [contractOutputTemplates.organizationId, contractOutputTemplates.key] });

  // Seed the visual flow too (the pipeline prefers it as source of truth).
  // Only when the org has no flow yet, so re-onboarding never clobbers edits.
  const existingFlow = await db.query.contractFlows.findFirst({
    where: (t, { eq }) => eq(t.organizationId, orgId),
  });
  if (!existingFlow) {
    await db.insert(contractFlows).values({
      id: randomUUID(), organizationId: orgId, name: preset.name, graphJson: presetToFlow(preset),
    });
  }
}
