import { CheckCircle2, Quote, Sparkles, TriangleAlert } from "lucide-react";

export type CaseAiAnalysis = {
  id: string;
  ruleName: string;
  severity: string;
  outputMode: string;
  outcome: string;
  summary: string | null;
  itemsJson: unknown;
  citationsJson: unknown;
};

function tone(outcome: string) {
  if (outcome === "pass") return { label: "Sin observaciones", cls: "bg-success/10 text-success", Icon: CheckCircle2 };
  if (outcome === "block") return { label: "Requiere bloqueo", cls: "bg-destructive/10 text-destructive", Icon: TriangleAlert };
  return { label: "Requiere revisión", cls: "bg-warning/10 text-warning", Icon: TriangleAlert };
}

function rows(value: unknown): Array<{ values: Record<string, unknown>; evidence: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as { values?: unknown; evidence?: unknown };
    if (!raw.values || typeof raw.values !== "object") return [];
    return [{ values: raw.values as Record<string, unknown>, evidence: typeof raw.evidence === "string" ? raw.evidence : null }];
  });
}

export function AiAnalysisResults({ analyses }: { analyses: CaseAiAnalysis[] }) {
  if (analyses.length === 0) return null;
  return (
    <section className="mt-3 space-y-3" aria-label="Resultados de análisis con IA">
      {analyses.map((analysis) => {
        const resultTone = tone(analysis.outcome);
        const Icon = resultTone.Icon;
        const findings = rows(analysis.itemsJson);
        const citations = Array.isArray(analysis.citationsJson) ? analysis.citationsJson.filter((citation): citation is string => typeof citation === "string" && citation.trim().length > 0).slice(0, 4) : [];
        return (
          <article key={analysis.id} className="overflow-hidden rounded-xl border border-primary/20 bg-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/[0.025] px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
              <p className="min-w-0 flex-1 text-xs font-semibold text-foreground">{analysis.ruleName}</p>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${resultTone.cls}`}><Icon className="h-3 w-3" />{resultTone.label}</span>
            </header>
            <div className="space-y-3 px-4 py-3">
              {analysis.summary && <p className="max-w-[72ch] text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap">{analysis.summary}</p>}
              {findings.length > 0 && <div className="overflow-x-auto rounded-lg border border-border"><table className="min-w-full text-left text-[11px]"><thead className="bg-secondary/55 text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground"><tr>{Object.keys(findings[0].values).map((key) => <th key={key} className="px-3 py-2">{key.replace(/_/g, " ")}</th>)}<th className="px-3 py-2">Evidencia</th></tr></thead><tbody className="divide-y divide-border">{findings.map((finding, index) => <tr key={index}>{Object.keys(findings[0].values).map((key) => <td key={key} className="max-w-52 px-3 py-2 align-top text-foreground">{String(finding.values[key] ?? "—")}</td>)}<td className="max-w-72 px-3 py-2 align-top text-muted-foreground">{finding.evidence ?? "—"}</td></tr>)}</tbody></table></div>}
              {citations.length > 0 && <div className="space-y-1.5 border-t border-border pt-2.5">{citations.map((citation, index) => <p key={index} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><Quote className="mt-0.5 h-3 w-3 shrink-0 text-primary" />{citation}</p>)}</div>}
            </div>
          </article>
        );
      })}
    </section>
  );
}
