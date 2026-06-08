"use client";

import { useState, useMemo } from "react";
import { Search, Package, Users, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogItem, CatalogVendor, CatalogLocation } from "./page";

interface Props {
  subsidiaries: { id: string; name: string }[];
  items: Record<string, CatalogItem[]>;
  vendors: Record<string, CatalogVendor[]>;
  locations: Record<string, CatalogLocation[]>;
}

type Tab = "items" | "vendors" | "locations";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "items",     label: "Ítems",       icon: Package },
  { id: "vendors",   label: "Proveedores",  icon: Users },
  { id: "locations", label: "Ubicaciones",  icon: MapPin },
];

export function CatalogsClient({ subsidiaries, items, vendors, locations }: Props) {
  const [selectedSub, setSelectedSub] = useState<string>(subsidiaries[0]?.id ?? "");
  const [tab, setTab]     = useState<Tab>("items");
  const [search, setSearch] = useState("");

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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Catálogos NetSuite</h1>
          <p className="text-xs text-muted-foreground">Ítems, proveedores y ubicaciones sincronizados</p>
        </div>
      </div>

      {/* Subsidiary selector */}
      {subsidiaries.length > 1 && (
        <div className="border-b border-border px-6 py-2.5 flex items-center gap-2 shrink-0">
          {subsidiaries.map(s => (
            <button
              key={s.id}
              onClick={() => { setSelectedSub(s.id); setSearch(""); }}
              className={cn(
                "px-3 py-[5px] text-xs rounded-md font-medium transition-all duration-[120ms]",
                selectedSub === s.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border shrink-0 px-6 flex items-center">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(""); }}
            className={cn(
              "flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-all duration-[120ms] border-b-2",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
              {tabCount(t.id).toLocaleString("es-MX")}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={placeholders[tab]}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-[7px] text-xs bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "items"     && <ItemsTable items={filteredItems} />}
        {tab === "vendors"   && <VendorsTable vendors={filteredVendors} />}
        {tab === "locations" && <LocationsTable locations={filteredLocations} />}
      </div>
    </div>
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
        El catálogo se sincroniza automáticamente desde NetSuite
      </p>
    </div>
  );
}
