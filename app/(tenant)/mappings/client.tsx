"use client";

import { useMemo, useState } from "react";
import { Search, GitMerge, CheckCircle2, Zap, User, ChevronDown, Plus, Pencil, Trash2, X, Save, Loader2, Database } from "lucide-react";
import { cn } from "@/lib/utils";

type Mapping = {
  id: number;
  subsidiaryId: string;
  subsidiaryName: string;
  vendor: string;
  vendorItemName: string;
  netsuiteInternalId: string;
  netsuiteItemName: string | null;
  netsuiteUnit: string | null;
  timesConfirmed: number;
  autoMap: boolean;
  lastConfirmed: string | null;
};

type EditorForm = {
  id: number | null;
  subsidiaryId: string;
  vendor: string;
  vendorItemName: string;
  netsuiteInternalId: string;
  netsuiteItemName: string;
  netsuiteUnit: string;
};

type CatalogSuggestion = { internalId: string; name: string; itemid: string; unit: string };
type ModeFilter = "all" | "auto" | "manual";
type ApiMapping = Omit<Mapping, "subsidiaryName"> & { subsidiaryName?: string };

interface Props {
  subsidiaries: { id: string; name: string }[];
  mappings: Mapping[];
  canManage: boolean;
}

function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function MappingsClient({ subsidiaries, mappings, canManage }: Props) {
  const [mappingRows, setMappingRows] = useState(mappings);
  const [subFilter, setSubFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorForm | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CatalogSuggestion[]>([]);
  const [searchingItems, setSearchingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const vendors = useMemo(
    () => Array.from(new Set(mappingRows.map(mapping => mapping.vendor).filter(Boolean))).sort(),
    [mappingRows],
  );

  const filtered = useMemo(() => {
    let result = mappingRows;
    if (subFilter !== "all") result = result.filter(mapping => mapping.subsidiaryId === subFilter);
    if (vendorFilter !== "all") result = result.filter(mapping => mapping.vendor === vendorFilter);
    if (modeFilter === "auto") result = result.filter(mapping => mapping.autoMap);
    if (modeFilter === "manual") result = result.filter(mapping => !mapping.autoMap);
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(mapping =>
        mapping.vendorItemName.toLowerCase().includes(query)
        || mapping.vendor.toLowerCase().includes(query)
        || (mapping.netsuiteItemName?.toLowerCase().includes(query) ?? false)
        || mapping.netsuiteInternalId.toLowerCase().includes(query),
      );
    }
    return result;
  }, [mappingRows, modeFilter, search, subFilter, vendorFilter]);

  const activeFilters = (subFilter !== "all" ? 1 : 0) + (vendorFilter !== "all" ? 1 : 0) + (modeFilter !== "all" ? 1 : 0);

  function openCreate() {
    setEditor({ id: null, subsidiaryId: subsidiaries[0]?.id ?? "", vendor: "", vendorItemName: "", netsuiteInternalId: "", netsuiteItemName: "", netsuiteUnit: "" });
    setItemQuery("");
    setSuggestions([]);
    setEditorError(null);
  }

  function openEdit(mapping: Mapping) {
    setEditor({
      id: mapping.id,
      subsidiaryId: mapping.subsidiaryId,
      vendor: mapping.vendor,
      vendorItemName: mapping.vendorItemName,
      netsuiteInternalId: mapping.netsuiteInternalId,
      netsuiteItemName: mapping.netsuiteItemName ?? "",
      netsuiteUnit: mapping.netsuiteUnit ?? "",
    });
    setItemQuery(mapping.netsuiteItemName ?? mapping.netsuiteInternalId);
    setSuggestions([]);
    setEditorError(null);
  }

  async function searchCatalogItems(query: string) {
    setItemQuery(query);
    if (!editor?.subsidiaryId || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setSearchingItems(true);
    try {
      const res = await fetch(`/api/v1/catalog/items?q=${encodeURIComponent(query.trim())}&subsidiaryId=${encodeURIComponent(editor.subsidiaryId)}`);
      const data = await res.json() as { items?: CatalogSuggestion[] };
      setSuggestions(res.ok ? data.items ?? [] : []);
    } catch {
      setSuggestions([]);
    } finally {
      setSearchingItems(false);
    }
  }

  function selectCatalogItem(item: CatalogSuggestion) {
    setEditor(current => current ? {
      ...current,
      netsuiteInternalId: item.internalId,
      netsuiteItemName: item.name || item.itemid,
      netsuiteUnit: item.unit,
    } : current);
    setItemQuery(item.name || item.itemid || item.internalId);
    setSuggestions([]);
  }

  function withSubsidiaryName(mapping: ApiMapping): Mapping {
    return {
      ...mapping,
      subsidiaryName: mapping.subsidiaryName
        ?? subsidiaries.find(subsidiary => subsidiary.id === mapping.subsidiaryId)?.name
        ?? mapping.subsidiaryId,
    };
  }

  async function saveMapping(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setEditorError(null);
    try {
      const res = await fetch(editor.id ? `/api/v1/mappings/${editor.id}` : "/api/v1/mappings", {
        method: editor.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor),
      });
      const data = await res.json() as { error?: string; mapping?: ApiMapping };
      if (!res.ok || !data.mapping) {
        setEditorError(data.error ?? "No se pudo guardar el mapeo");
        return;
      }
      const savedMapping = withSubsidiaryName(data.mapping);
      setMappingRows(current => editor.id
        ? current.map(mapping => mapping.id === editor.id ? savedMapping : mapping)
        : [savedMapping, ...current]);
      setEditor(null);
      setSuggestions([]);
    } catch {
      setEditorError("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMapping(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/mappings/${id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setEditorError(data.error ?? "No se pudo eliminar el mapeo");
        return;
      }
      setMappingRows(current => current.filter(mapping => mapping.id !== id));
    } catch {
      setEditorError("No se pudo conectar con el servidor");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Mapeos de ítems</h1>
          <p className="text-xs text-muted-foreground">
            {filtered.length !== mappingRows.length
              ? `${filtered.length.toLocaleString("es-MX")} de ${mappingRows.length.toLocaleString("es-MX")} mapeos`
              : `${mappingRows.length.toLocaleString("es-MX")} mapeos confirmados`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeFilters > 0 && <button onClick={() => { setSubFilter("all"); setVendorFilter("all"); setModeFilter("all"); setSearch(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Limpiar filtros</button>}
          {canManage && <button onClick={openCreate} disabled={subsidiaries.length === 0} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="w-3.5 h-3.5" />Nuevo mapeo</button>}
        </div>
      </div>

      <div className="border-b border-border px-6 py-3 flex items-center gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input type="search" placeholder="Buscar ítem, ID o proveedor..." value={search} onChange={event => setSearch(event.target.value)} className="w-full pl-9 pr-3 py-[7px] text-xs bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]" />
        </div>
        {vendors.length > 0 && (
          <div className="relative">
            <select value={vendorFilter} onChange={event => setVendorFilter(event.target.value)} className={cn("appearance-none pl-3 pr-7 py-[7px] text-xs rounded-md border transition-all duration-[120ms] outline-none cursor-pointer", vendorFilter !== "all" ? "bg-primary/10 border-primary/40 text-primary font-medium" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80")}>
              <option value="all">Todos los proveedores</option>
              {vendors.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-muted-foreground" />
          </div>
        )}
        <div className="flex items-center gap-1">
          {(["all", "auto", "manual"] as ModeFilter[]).map(mode => (
            <button key={mode} onClick={() => setModeFilter(mode)} className={cn("flex items-center gap-1 px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]", modeFilter === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
              {mode === "auto" && <Zap className="w-3 h-3" />}{mode === "manual" && <User className="w-3 h-3" />}{mode === "all" ? "Todos" : mode === "auto" ? "Auto" : "Manual"}
            </button>
          ))}
        </div>
        {subsidiaries.length > 1 && (
          <div className="flex items-center gap-1.5 border-l border-border pl-3">
            <button onClick={() => setSubFilter("all")} className={cn("px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]", subFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>Todas</button>
            {subsidiaries.map(subsidiary => <button key={subsidiary.id} onClick={() => setSubFilter(subsidiary.id)} className={cn("px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]", subFilter === subsidiary.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>{subsidiary.name}</button>)}
          </div>
        )}
      </div>

      {editor && (
        <form onSubmit={saveMapping} className="border-b border-border bg-card px-6 py-5">
          <div className="max-w-5xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="text-sm font-semibold text-foreground">{editor.id ? "Editar mapeo" : "Nuevo mapeo"}</h2><p className="mt-1 text-xs text-muted-foreground">El mapeo queda disponible de inmediato para sugerir líneas de facturas y órdenes de compra.</p></div>
              <button type="button" onClick={() => setEditor(null)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Cerrar editor"><X className="w-4 h-4" /></button>
            </div>
            {editorError && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{editorError}</p>}
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1.5 text-xs text-muted-foreground">Subsidiaria<select value={editor.subsidiaryId} onChange={event => { setEditor({ ...editor, subsidiaryId: event.target.value }); setSuggestions([]); }} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"><option value="">Selecciona una subsidiaria</option>{subsidiaries.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label>
              <label className="space-y-1.5 text-xs text-muted-foreground">Proveedor<input required value={editor.vendor} onChange={event => setEditor({ ...editor, vendor: event.target.value })} placeholder="Ej. Proveedor ABC" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" /></label>
              <label className="space-y-1.5 text-xs text-muted-foreground">Ítem en documento<input required value={editor.vendorItemName} onChange={event => setEditor({ ...editor, vendorItemName: event.target.value })} placeholder="Ej. Servicio de transporte" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" /></label>
              <label className="relative space-y-1.5 text-xs text-muted-foreground">Buscar ítem NetSuite<div className="relative mt-1.5"><Database className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={itemQuery} onChange={event => searchCatalogItems(event.target.value)} placeholder="Nombre o código de ítem" className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground outline-none focus:border-primary" />{searchingItems && <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}</div>{suggestions.length > 0 && <div className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-md">{suggestions.map(item => <button type="button" key={item.internalId} onClick={() => selectCatalogItem(item)} className="block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"><span className="block font-medium text-foreground">{item.name || item.itemid}</span><span className="text-muted-foreground">#{item.internalId}{item.itemid ? ` · ${item.itemid}` : ""}</span></button>)}</div>}</label>
              <label className="space-y-1.5 text-xs text-muted-foreground">Internal ID NetSuite<input required value={editor.netsuiteInternalId} onChange={event => setEditor({ ...editor, netsuiteInternalId: event.target.value })} placeholder="Ej. 123" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" /></label>
              <label className="space-y-1.5 text-xs text-muted-foreground">Nombre NetSuite<input value={editor.netsuiteItemName} onChange={event => setEditor({ ...editor, netsuiteItemName: event.target.value })} placeholder="Se completa al elegir del catálogo" className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" /></label>
            </div>
            <div className="mt-4 flex items-center gap-2"><button disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{editor.id ? "Guardar cambios" : "Crear mapeo"}</button><button type="button" onClick={() => setEditor(null)} disabled={saving} className="rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">Cancelar</button></div>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center"><GitMerge className="w-8 h-8 text-muted-foreground/30 mb-3" /><p className="text-sm font-medium text-foreground">{activeFilters > 0 || search ? "Sin resultados para los filtros seleccionados" : "Sin mapeos aún"}</p><p className="text-xs text-muted-foreground mt-1">{activeFilters > 0 || search ? "Intenta ajustar los filtros" : canManage ? "Crea uno manualmente o deja que el sistema aprenda al aprobar documentos" : "Los mapeos se crean automáticamente al procesar documentos"}</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border z-10"><tr>{["Ítem proveedor", "Proveedor", "Ítem NetSuite", "Unidad", "Confirma.", "Modo", "Últ. confirmación", ...(canManage ? ["Acciones"] : [])].map(header => <th key={header} className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {filtered.map(mapping => (
                <tr key={mapping.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                  <td className="px-5 py-3"><p className="text-xs font-medium text-foreground leading-snug">{mapping.vendorItemName}</p>{subsidiaries.length > 1 && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{mapping.subsidiaryName}</p>}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{mapping.vendor}</td>
                  <td className="px-5 py-3"><p className="text-xs text-foreground leading-snug">{mapping.netsuiteItemName ?? mapping.netsuiteInternalId}</p><p className="text-[0.6875rem] text-muted-foreground font-mono mt-0.5">#{mapping.netsuiteInternalId}</p></td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{mapping.netsuiteUnit ?? "—"}</td>
                  <td className="px-5 py-3"><div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-success shrink-0" /><span className="text-xs tabular-nums text-foreground">{mapping.timesConfirmed}</span></div></td>
                  <td className="px-5 py-3"><span className={cn("inline-flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", mapping.autoMap ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground")}>{mapping.autoMap ? <Zap className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}{mapping.autoMap ? "Auto" : "Manual"}</span></td>
                  <td className="px-5 py-3 text-[0.6875rem] text-muted-foreground tabular-nums">{mapping.lastConfirmed ? relativeDate(mapping.lastConfirmed) : "—"}</td>
                  {canManage && <td className="px-5 py-3">{deletingId === mapping.id ? <div className="flex items-center gap-2 whitespace-nowrap"><button onClick={() => deleteMapping(mapping.id)} className="text-xs font-medium text-destructive hover:underline">Eliminar</button><button onClick={() => setDeletingId(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button></div> : <div className="flex items-center gap-1"><button onClick={() => openEdit(mapping)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label={`Editar ${mapping.vendorItemName}`}><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => setDeletingId(mapping.id)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" aria-label={`Eliminar ${mapping.vendorItemName}`}><Trash2 className="h-3.5 w-3.5" /></button></div>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
