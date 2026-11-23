"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Package, Users, MapPin, RefreshCw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, PageFrame, ViewTabs } from "@/components/kit";
import { SubsidiaryPicker } from "@/components/tenant/subsidiary-picker";
import type { CatalogItem, CatalogVendor, CatalogLocation } from "./page";

interface Props {
  subsidiaries: { id: string; name: string }[];
  selectedSub: string;
  items: Record<string, CatalogItem[]>;
  vendors: Record<string, CatalogVendor[]>;
  locations: Record<string, CatalogLocation[]>;
  /** Which lists reached the page's limit and are therefore incomplete. */
  cut?: { items: boolean; vendors: boolean; locations: boolean };
  isAdmin: boolean;
}

type Tab = "items" | "vendors" | "locations";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "items",     label: "Ítems",       icon: Package },
  { id: "vendors",   label: "Proveedores",  icon: Users },
  { id: "locations", label: "Ubicaciones",  icon: MapPin },
];

export function CatalogsClient({ subsidiaries, selectedSub, items, vendors, locations, cut, isAdmin }: Props) {
  const router = useRouter();
  const setSelectedSub = (id: string) => { setSyncMsg(null); router.push(`/catalogs?sub=${encodeURIComponent(id)}`); };
  const [tab, setTab]     = useState<Tab>("items");
  const [search, setSearch] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function handleSync() {
    if (!selectedSub) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/v1/catalogs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subsidiaryId: selectedSub }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncMsg({ ok: false, text: data.error ?? "Error al sincronizar" }); return; }
      const s = data.summary ?? {};
      const parts = ["items", "vendors", "locations"]
        .filter(k => typeof s[k] === "number")
        .map(k => `${k === "locations" ? "ubicaciones" : k === "vendors" ? "proveedores" : "ítems"}: ${s[k]}`);
      setSyncMsg({ ok: true, text: parts.length ? parts.join(" · ") : "Catálogo sincronizado" });
      router.refresh();
    } catch {
      setSyncMsg({ ok: false, text: "No se pudo conectar al servidor" });
    } finally {
      setSyncing(false);
    }
  }

  const currentItems     = items[selectedSub] ?? [];
  const currentVendors   = vendors[selectedSub] ?? [];
  const currentLocations = locations[selectedSub] ?? [];

  const filteredItems = useMemo(() => {
    if (!search.trim()) return currentItems;
    const q = search.toLowerCase();
    return currentItems.filter(i =>
      i.name?.toLowerCase().includes(q) ||
      i.itemid?.toLowerCase().includes(q) ||
      i.internalId.includes(q)
    );
  }, [currentItems, search]);

  const filteredVendors = useMemo(() => {
    if (!search.trim()) return currentVendors;
    const q = search.toLowerCase();
    return currentVendors.filter(v =>
      v.name?.toLowerCase().includes(q) ||
      v.rfc?.toLowerCase().includes(q) ||
      v.entityid?.toLowerCase().includes(q)
    );
  }, [currentVendors, search]);

  const filteredLocations = useMemo(() => {
    if (!search.trim()) return currentLocations;
    const q = search.toLowerCase();
    return currentLocations.filter(l =>
      l.name?.toLowerCase().includes(q) ||
      l.fullName?.toLowerCase().includes(q)
    );
  }, [currentLocations, search]);

  function tabCount(t: Tab) {
    if (t === "items")     return (items[selectedSub] ?? []).length;
    if (t === "vendors")   return (vendors[selectedSub] ?? []).length;
    return (locations[selectedSub] ?? []).length;
  }

  const placeholders: Record<Tab, string> = {
    items:     "Buscar por nombre, código o ID...",
    vendors:   "Buscar por nombre, RFC o entidad...",
    locations: "Buscar por nombre o nombre completo...",
  };

  return (
    <PageFrame>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">Configuración</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em]">Catálogos del ERP</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Ítems, proveedores y ubicaciones que DocuIA usa para leer y enviar facturas. Vienen del ERP.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {subsidiaries.length > 1 && (
            <SubsidiaryPicker subsidiaries={subsidiaries} value={selectedSub} onChange={(id) => { setSelectedSub(id); setSearch(""); }} />
          )}
          {isAdmin && (
            <button type="button" onClick={handleSync} disabled={syncing || !selectedSub} className={btn("secondary")}>
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{syncing ? "Sincronizando…" : "Sincronizar"}
            </button>
          )}
        </div>
      </div>
      {syncMsg && (
        <p role="status" className={cn("mt-3 flex items-center gap-1.5 text-[13px]", syncMsg.ok ? "text-tone-ok" : "text-tone-err")}>
          {syncMsg.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}{syncMsg.text}
        </p>
      )}

      <ViewTabs className="mt-6" items={TABS.map((t) => ({ key: t.id, label: t.label, count: tabCount(t.id), active: tab === t.id, onSelect: () => { setTab(t.id); setSearch(""); } }))} />

      <label className="relative mt-4 block w-full sm:w-[300px]">
        <span className="sr-only">Buscar</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder={placeholders[tab]} value={search} onChange={e => setSearch(e.target.value)}
          className="min-h-10 w-full rounded-lg border border-[#D6D2C8] bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </label>

      <div className="mt-3.5 overflow-x-auto rounded-xl border border-border bg-card">
        {cut?.[tab] && (
          <p className="border-b border-border bg-secondary/50 px-3.5 py-2.5 text-[13px] text-muted-foreground">
            Esta lista es más larga de lo que cabe en la pantalla: se muestran los primeros {(tab === "locations" ? 2000 : 5000).toLocaleString("es-MX")} por nombre, y la búsqueda solo recorre esos. Lo que no aparece aquí sigue disponible al revisar una factura.
          </p>
        )}
        {tab === "items"     && <ItemsTable items={filteredItems} />}
        {tab === "vendors"   && <VendorsTable vendors={filteredVendors} />}
        {tab === "locations" && <LocationsTable locations={filteredLocations} />}
      </div>
    </PageFrame>
  );
}

function ItemsTable({ items }: { items: CatalogItem[] }) {
  if (items.length === 0) return <EmptyState noun="ítems" />;
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card border-b border-border z-10">
        <tr>
          {["ID Interno", "Código", "Nombre", "Tipo", "Unidad"].map(h => (
            <th key={h} className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {items.map(i => (
          <tr key={i.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
            <td className="px-5 py-3 font-mono text-[0.6875rem] text-muted-foreground">{i.internalId}</td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{i.itemid ?? "—"}</td>
            <td className="px-5 py-3 text-xs font-medium text-foreground">{i.name ?? "—"}</td>
            <td className="px-5 py-3">
              {i.type && (
                <span className="text-[0.6875rem] bg-secondary text-muted-foreground px-2 py-0.5 rounded-sm font-medium">
                  {i.type}
                </span>
              )}
            </td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{i.unit ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VendorsTable({ vendors }: { vendors: CatalogVendor[] }) {
  if (vendors.length === 0) return <EmptyState noun="proveedores" />;
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card border-b border-border z-10">
        <tr>
          {["ID Interno", "Entidad", "Nombre", "RFC", "Email", "Estado"].map(h => (
            <th key={h} className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {vendors.map(v => (
          <tr
            key={v.id}
            className={cn(
              "hover:bg-accent/40 transition-colors duration-[120ms]",
              v.isInactive && "opacity-50"
            )}
          >
            <td className="px-5 py-3 font-mono text-[0.6875rem] text-muted-foreground">{v.internalId}</td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{v.entityid ?? "—"}</td>
            <td className="px-5 py-3 text-xs font-medium text-foreground">{v.name ?? "—"}</td>
            <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{v.rfc ?? "—"}</td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{v.email ?? "—"}</td>
            <td className="px-5 py-3">
              <span className={cn(
                "text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm",
                v.isInactive
                  ? "bg-secondary text-muted-foreground"
                  : "bg-success/10 text-success"
              )}>
                {v.isInactive ? "Inactivo" : "Activo"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LocationsTable({ locations }: { locations: CatalogLocation[] }) {
  if (locations.length === 0) return <EmptyState noun="ubicaciones" />;
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card border-b border-border z-10">
        <tr>
          {["ID Interno", "Nombre", "Nombre completo", "Estado"].map(h => (
            <th key={h} className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {locations.map(l => (
          <tr
            key={l.id}
            className={cn(
              "hover:bg-accent/40 transition-colors duration-[120ms]",
              l.isInactive && "opacity-50"
            )}
          >
            <td className="px-5 py-3 font-mono text-[0.6875rem] text-muted-foreground">{l.internalId}</td>
            <td className="px-5 py-3 text-xs font-medium text-foreground">{l.name ?? "—"}</td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{l.fullName ?? "—"}</td>
            <td className="px-5 py-3">
              <span className={cn(
                "text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm",
                l.isInactive
                  ? "bg-secondary text-muted-foreground"
                  : "bg-success/10 text-success"
              )}>
                {l.isInactive ? "Inactiva" : "Activa"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState({ noun }: { noun: string }) {
  return (
    <div className="py-20 flex flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-foreground">Sin {noun}</p>
      <p className="text-xs text-muted-foreground mt-1">
        El catálogo se sincroniza automáticamente desde el ERP
      </p>
    </div>
  );
}
