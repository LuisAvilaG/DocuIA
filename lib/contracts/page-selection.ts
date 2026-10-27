import type { FieldDef } from "./extract";
import type { IndexedPageText } from "./reference-codes";

function words(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
}

/** A bounded, explainable page selection rather than the PDF's first 24k chars. */
export function selectPagesForFields(pages: IndexedPageText[], fields: FieldDef[], maxChars = 20_000): string {
  if (pages.length === 0) return "";
  const terms = new Set(fields.flatMap((field) => words(`${field.fieldKey} ${field.label}`)));
  const ranked = pages.map((page, index) => {
    const normalized = words(page.text);
    const present = new Set(normalized);
    const hits = [...terms].filter((term) => present.has(term)).length;
    const score = hits * 10 + (index === 0 ? 8 : index === 1 ? 3 : 0) + (page.text.length > 50 ? 1 : 0);
    return { page, score };
  }).sort((a, b) => b.score - a.score || a.page.pageNumber - b.page.pageNumber);
  const selected: IndexedPageText[] = [];
  let used = 0;
  for (const { page } of ranked) {
    const remaining = maxChars - used - 30;
    if (remaining < 200) break;
    const text = page.text.trim();
    if (!text) continue;
    selected.push({ pageNumber: page.pageNumber, text: text.slice(0, Math.min(remaining, 3500)) });
    used += Math.min(remaining, text.length, 3500) + 30;
  }
  return selected.sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => `[Página ${page.pageNumber}]\n${page.text}`).join("\n\n");
}

export function fieldBatches<T>(fields: T[], size = 7): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < fields.length; i += size) batches.push(fields.slice(i, i + size));
  return batches;
}
