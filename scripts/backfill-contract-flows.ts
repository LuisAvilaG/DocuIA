import "./_load-env";
import { randomUUID } from "crypto";
import { eq, asc } from "drizzle-orm";
import { db } from "../lib/db";
import { contractDocTypes, contractFieldSchemas, contractValidationRules, contractOutputTemplates, contractFlows } from "../db/schema";
import { presetToFlow } from "../lib/contracts/flow";
import type { ContractPreset } from "../lib/contracts/presets";

// Backfill a visual flow for every org that has contract config but no flow yet,
// derived from their CURRENT tables (so any edits they made are preserved).
async function main() {
  const orgs = await db.selectDistinct({ orgId: contractDocTypes.organizationId }).from(contractDocTypes);
  let created = 0, skipped = 0;

  for (const { orgId } of orgs) {
    const existing = await db.query.contractFlows.findFirst({ where: eq(contractFlows.organizationId, orgId) });
    if (existing) { skipped++; continue; }

    const [types, fields, rules, templates] = await Promise.all([
      db.query.contractDocTypes.findMany({ where: eq(contractDocTypes.organizationId, orgId), orderBy: [asc(contractDocTypes.sortOrder)] }),
      db.query.contractFieldSchemas.findMany({ where: eq(contractFieldSchemas.organizationId, orgId), orderBy: [asc(contractFieldSchemas.sortOrder)] }),
      db.query.contractValidationRules.findMany({ where: eq(contractValidationRules.organizationId, orgId), orderBy: [asc(contractValidationRules.sortOrder)] }),
      db.query.contractOutputTemplates.findMany({ where: eq(contractOutputTemplates.organizationId, orgId) }),
    ]);

    const preset: ContractPreset = {
      key: "backfill",
      name: templates[0]?.name ?? "Flujo de contratos",
      docTypes: types.map((t) => ({
        key: t.key, name: t.name, hint: t.classificationHint ?? undefined,
        fields: fields.filter((f) => f.docTypeKey === t.key).map((f) => ({ key: f.fieldKey, label: f.label, isList: f.isList })),
      })),
      rules: rules.map((r) => ({ name: r.name, appliesTo: r.appliesTo, conditions: r.conditionsJson })),
      template: templates[0]
        ? { key: templates[0].key, name: templates[0].name, body: templates[0].body }
        : { key: "salida", name: "Documento de salida", body: "" },
    };

    await db.insert(contractFlows).values({ id: randomUUID(), organizationId: orgId, name: preset.name, graphJson: presetToFlow(preset) });
    created++;
    console.log(`flujo creado · org ${orgId} · ${types.length} tipos, ${rules.length} reglas`);
  }

  console.log(`\nBackfill: ${created} creados, ${skipped} ya tenían flujo.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
