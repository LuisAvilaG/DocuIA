"use client";

import { useMemo, useState } from "react";
import { Search, CheckCircle2, Plus, Pencil, Trash2, Loader2, Database } from "lucide-react";
import { btn, Drawer, EmptyState, PageFrame } from "@/components/kit";
import { cn } from "@/lib/utils";
import { SubsidiaryPicker } from "@/components/tenant/subsidiary-picker";

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
  /** There are more mappings than the ones loaded. */
  truncated?: boolean;
}

function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function MappingsClient({ subsidiaries, mappings, canManage, truncated = false }: Props) {
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
  // Shown above the list: the editor panel is closed when a row is deleted.
  const [listError, setListError] = useState<string | null>(null);
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
    setListError(null);
    try {
      const res = await fetch(`/api/v1/mappings/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setListError(data.error ?? "No se pudo eliminar el mapeo");
        return;
      }
      setMappingRows(current => current.filter(mapping => mapping.id !== id));
    } catch {
      setListError("No se pudo eliminar el mapeo: no hay conexión con el servidor");
    } finally {
      setDeletingId(null);
    }
  }

  const field = "mt-1.5 w-full min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return (
    <PageFrame>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Configuración</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Mapeos</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Cómo llama cada proveedor a sus productos y a qué ítem del ERP corresponden. Se aprenden solos al revisar facturas.</p>
        </div>
        {canManage && <button type="button" onClick={openCreate} disabled={subsidiaries.length === 0} className={btn("primary")}><Plus />Nuevo mapeo</button>}
      </div>

      {listError && <p role="alert" className="mt-3 text-[13px] text-tone-err">{listError}</p>}
      {truncated && (
        <p className="mt-3 text-[13px] text-tone-warn">Se muestran los {mappings.length.toLocaleString("es-MX")} mapeos más recientes. La búsqueda y los filtros solo ven estos; hay más que no aparecen aquí.</p>
      )}

      <div className="mt-4.5 flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-[280px]">
          <span className="sr-only">Buscar</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" placeholder="Buscar descripción o ítem" value={search} onChange={event => setSearch(event.target.value)} className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        {vendors.length > 0 && (
          <select aria-label="Proveedor" value={vendorFilter} onChange={event => setVendorFilter(event.target.value)} className="min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-sm">
            <option value="all">Todos los proveedores</option>
            {vendors.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>
        )}
        <div role="group" aria-label="Origen" className="flex overflow-hidden rounded-[9px] border border-[#D6D2C8] bg-white">
          {(["all", "auto", "manual"] as ModeFilter[]).map(mode => (
            <button key={mode} type="button" aria-pressed={modeFilter === mode} onClick={() => setModeFilter(mode)}
              className={cn("min-h-10 border-r border-[#D6D2C8] px-3.5 text-[13.5px] last:border-r-0", modeFilter === mode ? "bg-foreground font-semibold text-background" : "font-medium text-foreground/75 hover:text-foreground")}>
              {mode === "all" ? "Todos" : mode === "auto" ? "Aprendidos" : "Manuales"}
            </button>
          ))}
        </div>
        {subsidiaries.length > 1 && <SubsidiaryPicker subsidiaries={subsidiaries} value={subFilter} onChange={setSubFilter} allLabel="Todas las subsidiarias" />}
        {activeFilters > 0 && <button type="button" onClick={() => { setSubFilter("all"); setVendorFilter("all"); setModeFilter("all"); setSearch(""); }} className={btn("text", "sm")}>Limpiar</button>}
      </div>

      {editor && (
        <Drawer
          title={editor.id ? "Editar mapeo" : "Nuevo mapeo"}
          description="Queda disponible de inmediato para sugerir líneas de facturas y órdenes de compra."
          onClose={() => setEditor(null)}
          locked={saving}
          width={520}
          footer={<>
            <button type="button" onClick={() => setEditor(null)} disabled={saving} className={btn("secondary")}>Cancelar</button>
            <button type="submit" form="mapping-form" disabled={saving} className={btn("primary")}>{saving && <Loader2 className="animate-spin" />}{editor.id ? "Guardar cambios" : "Crear mapeo"}</button>
          </>}
        >
          <form id="mapping-form" onSubmit={saveMapping} className="flex flex-col gap-4 text-[13px] font-semibold text-foreground/90">
            {editorError && <p role="alert" className="text-sm font-normal text-tone-err">{editorError}</p>}
            <label>Subsidiaria<select value={editor.subsidiaryId} onChange={event => { setEditor({ ...editor, subsidiaryId: event.target.value }); setSuggestions([]); }} className={field}><option value="">Elige una subsidiaria</option>{subsidiaries.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label>
            <label>Proveedor<input required value={editor.vendor} onChange={event => setEditor({ ...editor, vendor: event.target.value })} placeholder="Ej. Proveedor ABC" className={field} /></label>
            <label>Cómo aparece en la factura<input required value={editor.vendorItemName} onChange={event => setEditor({ ...editor, vendorItemName: event.target.value })} placeholder="Ej. Servicio de transporte" className={field} /></label>
            <label className="relative">Ítem del ERP
              <div className="relative">
                <Database className="pointer-events-none absolute left-3 top-[calc(50%+3px)] size-4 -translate-y-1/2 text-muted-foreground" />
                <input value={itemQuery} onChange={event => searchCatalogItems(event.target.value)} placeholder="Busca por nombre o código" className={cn(field, "pl-9 pr-8")} />
                {searchingItems && <Loader2 className="absolute right-3 top-[calc(50%+3px)] size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>
              {suggestions.length > 0 && <div className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-lg border border-border bg-card py-1 font-normal shadow-md">{suggestions.map(item => <button type="button" key={item.internalId} onClick={() => selectCatalogItem(item)} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-secondary"><span className="block font-medium">{item.name || item.itemid}</span><span className="text-muted-foreground">#{item.internalId}{item.itemid ? ` · ${item.itemid}` : ""}</span></button>)}</div>}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>ID en el ERP<input required value={editor.netsuiteInternalId} onChange={event => setEditor({ ...editor, netsuiteInternalId: event.target.value })} placeholder="Ej. 123" className={field} /></label>
              <label>Nombre en el ERP<input value={editor.netsuiteItemName} onChange={event => setEditor({ ...editor, netsuiteItemName: event.target.value })} placeholder="Se completa al elegir" className={field} /></label>
            </div>
          </form>
        </Drawer>
      )}

      <div className="mt-3.5 overflow-x-auto rounded-xl border border-border bg-card">
        {filtered.length === 0 ? (
          <EmptyState className="border-0" title={activeFilters > 0 || search ? "Nada coincide con estos filtros" : "Sin mapeos todavía"}>
            {activeFilters > 0 || search ? "Prueba con otra búsqueda." : "Se aprenden solos al revisar facturas; también puedes crearlos a mano."}
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border"><tr>{["En la factura", "Proveedor", "Ítem del ERP", "Unidad", "Confirmado", "Origen", "Última vez", ...(canManage ? [""] : [])].map(header => <th key={header} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{header || <span className="sr-only">Acciones</span>}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {filtered.map(mapping => (
                <tr key={mapping.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                  <td className="px-3.5 py-3"><p className="text-xs font-medium text-foreground leading-snug">{mapping.vendorItemName}</p>{subsidiaries.length > 1 && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{mapping.subsidiaryName}</p>}</td>
                  <td className="px-3.5 py-3 text-xs text-muted-foreground">{mapping.vendor}</td>
                  <td className="px-3.5 py-3"><p className="text-xs text-foreground leading-snug">{mapping.netsuiteItemName ?? mapping.netsuiteInternalId}</p><p className="text-[0.6875rem] text-muted-foreground font-mono mt-0.5">#{mapping.netsuiteInternalId}</p></td>
                  <td className="px-3.5 py-3 text-xs text-muted-foreground">{mapping.netsuiteUnit ?? "—"}</td>
                  <td className="px-3.5 py-3"><div className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-success shrink-0" /><span className="text-xs tabular-nums text-foreground">{mapping.timesConfirmed}</span></div></td>
                  <td className="px-3.5 py-3"><span className={cn("inline-flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", mapping.autoMap ? "bg-tone-info-bg text-tone-info" : "bg-tone-mute-bg text-tone-mute")}>{mapping.autoMap ? "Aprendido" : "Manual"}</span></td>
                  <td className="px-3.5 py-3 text-[0.6875rem] text-muted-foreground tabular-nums">{mapping.lastConfirmed ? relativeDate(mapping.lastConfirmed) : "—"}</td>
                  {canManage && <td className="px-3.5 py-3">{deletingId === mapping.id ? <div className="flex items-center gap-2 whitespace-nowrap"><button onClick={() => deleteMapping(mapping.id)} className="text-xs font-medium text-destructive hover:underline">Eliminar</button><button onClick={() => setDeletingId(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button></div> : <div className="flex items-center gap-1"><button onClick={() => openEdit(mapping)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label={`Editar ${mapping.vendorItemName}`}><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => setDeletingId(mapping.id)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" aria-label={`Eliminar ${mapping.vendorItemName}`}><Trash2 className="h-3.5 w-3.5" /></button></div>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageFrame>
  );
}
