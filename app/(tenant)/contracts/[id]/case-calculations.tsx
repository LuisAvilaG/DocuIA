// Cálculos del caso como hoja de cuentas: primero los datos de partida, luego
// cada resultado con su operación completa (base × factor = resultado) y la
// página de donde sale. Sin tarjetas ni cifras grandes: renglones y líneas finas.
import Link from "next/link";
import { SectionTitle } from "@/components/kit";
import type { CalculationOperation, CalculationResult } from "@/lib/contracts/calculations";

const nf = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 6 });
const pretty = (k: string) => k.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
const SIGN: Record<CalculationOperation, string> = { percentage: "×", multiply: "×", add: "+", subtract: "−", divide: "÷" };

const th = "whitespace-nowrap border-b border-border px-3 py-[9px] text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-foreground/75 first:pl-0 last:pr-0";
const td = "border-b border-line-soft px-3 py-[11px] align-baseline first:pl-0 last:pr-0";
const num = "whitespace-nowrap text-right tabular-nums";
const sign = "w-7 px-0 text-center text-muted-foreground";

/** Name of one item of an analysis: the column that says what it is, never one of the numbers. */
export function calculationItemName(values: Record<string, string>, index: number): string {
  return values.amparo || values.nombre || values.concepto
    || Object.values(values).find((value) => value && !/^[\d\s.,%$-]+$/.test(value))
    || `Elemento ${index + 1}`;
}

/** Every result in one line (name, factor when known, value): the summary of Decisión and of Aprobaciones. */
export function summarizeCalculations(calculations: CalculationResult[]): Array<{ key: string; name: string; value: number | null }> {
  return calculations.flatMap((calc) => {
    const factor = (operand: number | null | undefined) => (operand === null || operand === undefined || !calc.operation ? null : `${nf(operand)}${calc.operation === "percentage" ? " %" : ""}`);
    return calc.items
      ? calc.items.map((entry, index) => ({ key: `${calc.key}-${index}`, name: [calculationItemName(entry.values, index), factor(entry.operand ?? calc.parts?.operand.value)].filter(Boolean).join(" · "), value: entry.value }))
      : [{ key: calc.key, name: calc.label, value: calc.value }];
  });
}

/** The quote as the validations keep it, to look up the page where it was found. */
export const evidenceKey = (quote: string) => quote.trim().slice(0, 400);

function Operation({ operation, base, operand, formula }: { operation?: CalculationOperation; base: number | null | undefined; operand: number | null | undefined; formula: string }) {
  // Cases analysed before the operation was kept only have its description.
  if (!operation) return <td colSpan={4} className={`${td} text-muted-foreground`}>{formula}</td>;
  return (
    <>
      <td className={`${td} ${num}`}>{base === null || base === undefined ? "—" : nf(base)}</td>
      <td className={`${td} ${sign}`}>{SIGN[operation]}</td>
      <td className={`${td} ${num}`}>{operand === null || operand === undefined ? "—" : `${nf(operand)}${operation === "percentage" ? " %" : ""}`}</td>
      <td className={`${td} ${sign}`}>=</td>
    </>
  );
}

function Result({ value, status }: { value: number | null; status: string }) {
  return (
    <td className={`${td} ${num} font-semibold ${status === "ok" ? "" : "text-tone-warn"}`}>{value === null ? "Por revisar" : nf(value)}</td>
  );
}

export function CaseCalculations({ calculations, docNames, pages }: {
  calculations: CalculationResult[];
  /** Document of the case for each document type, to say where a value was read. */
  docNames: Record<string, string>;
  /** Page of each quote already located by the validations. */
  pages: Record<string, number>;
}) {
  const starts = new Map<string, { label: string; value: number; origin: React.ReactNode }>();
  for (const calc of calculations) {
    for (const part of calc.parts ? [calc.parts.base, calc.parts.operand] : []) {
      if ((part.source !== "field" && part.source !== "fixed") || part.value === null) continue;
      const key = `${part.source}:${part.docType ?? ""}:${part.name}`;
      if (starts.has(key)) continue;
      starts.set(key, {
        label: part.source === "fixed" ? part.label || pretty(part.name) : pretty(part.name),
        value: part.value,
        origin: part.source === "fixed"
          ? "Valor fijo del flujo"
          : <>Leído de {docNames[part.docType ?? ""] ?? "los documentos"} · <Link href="?etapa=docs" className="text-link hover:underline">ver dato</Link></>,
      });
    }
  }
  const single = calculations.filter((calc) => !calc.items);
  const grouped = calculations.filter((calc) => calc.items);
  const multiplies = calculations.every((calc) => !calc.operation || calc.operation === "percentage" || calc.operation === "multiply");

  return (
    <div className="flex flex-col gap-7.5">
      {starts.size > 0 && (
        <section aria-labelledby="calc-start">
          <SectionTitle title={<span id="calc-start">Datos de partida</span>} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <tbody>
                {[...starts.entries()].map(([key, start]) => (
                  <tr key={key}>
                    <td className={td}>{start.label}</td>
                    <td className={`${td} text-[12.5px] text-muted-foreground`}>{start.origin}</td>
                    <td className={`${td} ${num} font-semibold`}>{nf(start.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="calc-results">
        <SectionTitle title={<span id="calc-results">Resultado de cada cálculo</span>} aside="Base × factor = resultado" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th scope="col" className={th}>Concepto</th>
                <th scope="col" className={`${th} text-right`}>Base</th>
                <th className={`${th} ${sign}`} />
                <th scope="col" className={`${th} text-right`}>{multiplies ? "Factor" : "Valor"}</th>
                <th className={`${th} ${sign}`} />
                <th scope="col" className={`${th} text-right`}>Resultado</th>
                <th scope="col" className={th}>Dónde</th>
              </tr>
            </thead>
            <tbody>
              {single.map((calc) => (
                <tr key={calc.key}>
                  <td className={td}>{calc.label}{calc.reason && <small className="block text-[12.5px] text-tone-warn">{calc.reason}</small>}</td>
                  <Operation operation={calc.operation} base={calc.parts?.base.value ?? calc.sourceValue} operand={calc.parts?.operand.value} formula={calc.formula} />
                  <Result value={calc.value} status={calc.status} />
                  <td className={`${td} text-muted-foreground`}>—</td>
                </tr>
              ))}
              {grouped.flatMap((calc) => [
                <tr key={calc.key}>
                  <th colSpan={7} scope="colgroup" className="border-b border-border pb-[7px] pt-[18px] text-left text-[12.5px] font-medium text-muted-foreground">{calc.label}</th>
                </tr>,
                ...(calc.items ?? []).map((entry, index) => {
                  const page = entry.evidence ? pages[evidenceKey(entry.evidence)] : undefined;
                  return (
                    <tr key={`${calc.key}-${index}`}>
                      <td className={td}>{calculationItemName(entry.values, index)}{entry.reason && <small className="block text-[12.5px] text-tone-warn">{entry.reason}</small>}</td>
                      <Operation operation={calc.operation} base={entry.base ?? calc.parts?.base.value} operand={entry.operand ?? calc.parts?.operand.value} formula={calc.formula} />
                      <Result value={entry.value} status={entry.status} />
                      <td className={`${td} whitespace-nowrap`}>
                        {entry.evidence
                          ? <Link href="?etapa=checks" className="text-link hover:underline">{page ? `p. ${page}` : "Ver cita"}</Link>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                }),
                ...(calc.items?.length ? [] : [
                  <tr key={`${calc.key}-none`}><td colSpan={7} className={`${td} text-tone-warn`}>{calc.reason ?? "No se encontraron elementos para calcular."}</td></tr>,
                ]),
              ])}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
