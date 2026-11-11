"use client";

import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

type VendorOption = { internalId: string; name: string; entityid: string };
type Answer = { label: string; via: "vendor" | "category" | "default" | "general"; categoryName: string | null };

const VIA: Record<Answer["via"], string> = {
  vendor: "por regla propia del proveedor",
  category: "por su categoría en el ERP",
  default: "no tiene regla propia ni de su categoría",
  general: "no hay reglas; usa la configuración general",
};

/** «¿Qué regla se aplica a…?» con la misma prioridad que usa el envío. */
export function RuleFinder() {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<VendorOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);

  async function search(q: string) {
    setQuery(q); setAnswer(null); setError("");
    const my = ++seq.current;
    if (q.trim().length < 2) { setOptions([]); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/catalog/vendors?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (my === seq.current) setOptions(Array.isArray(data.vendors) ? data.vendors.slice(0, 8) : []);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  async function pick(v: VendorOption) {
    setQuery(v.name || v.entityid); setOptions([]); setBusy(true); setError("");
    try {
      const res = await fetch(`/api/v1/vendor-rules/resolve?vendorId=${encodeURIComponent(v.internalId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo resolver."); return; }
      setAnswer(data as Answer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="search" className="relative mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <label htmlFor="rule-finder">¿Qué regla se aplica a</label>
      <span className="relative">
        <input id="rule-finder" value={query} onChange={(e) => search(e.target.value)} placeholder="un proveedor"
          className="min-h-9 w-[220px] rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        {busy && <Loader2 aria-hidden className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {options.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-72 overflow-auto rounded-lg border border-border bg-card py-1 shadow-md">
            {options.map((v) => (
              <button key={v.internalId} type="button" onClick={() => pick(v)} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-secondary">
                <span className="block font-medium">{v.name || v.entityid}</span>
                <span className="text-muted-foreground">#{v.internalId}{v.entityid ? ` · ${v.entityid}` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </span>
      <span>?</span>
      {answer && (
        <span role="status" className="inline-flex items-center gap-2 rounded-lg bg-tone-info-bg px-2.5 py-1.5 text-[13.5px] font-semibold text-[#0B5F56]">
          <Check aria-hidden className="size-4" />{answer.label} · <span className="font-normal">{VIA[answer.via]}{answer.via === "category" && answer.categoryName ? ` (${answer.categoryName})` : ""}</span>
        </span>
      )}
      {error && <span role="alert" className="text-[13px] text-tone-err">{error}</span>}
    </div>
  );
}
