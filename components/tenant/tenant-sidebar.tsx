"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FileUp, FileText, Clock, AlertTriangle,
  GitMerge, Database, SlidersHorizontal, BarChart3, Settings, Workflow, ClipboardCheck,
  LogOut, User, Zap, Crown, Receipt, ScrollText, FolderOpen, BrainCircuit, KeyRound, ListChecks,
} from "lucide-react";
import { useState } from "react";
import { ChangePasswordDialog } from "@/components/shared/change-password-dialog";
import Image from "next/image";
import { useFeatures } from "@/components/providers/feature-provider";
import { PRODUCTS, PRODUCT_AREA, PRODUCT_MODULES, PLATFORM_MODULES, productForPath, type ProductKey, type NavModule } from "@/lib/products/registry";
import { canAccessTenantArea, TENANT_ROLE_LABELS, isTenantRole } from "@/lib/auth/permissions";

// lucide icon name → component (registry stores names as strings)
const ICONS: Record<string, React.ElementType> = {
  LayoutDashboard, FileUp, FileText, Clock, AlertTriangle, GitMerge, Database, SlidersHorizontal,
  BarChart3, Settings, Workflow, ClipboardCheck, Receipt, ScrollText, FolderOpen, BrainCircuit, ListChecks,
};

const PLAN_BADGE: Record<string, string> = {
  starter:    "bg-secondary text-muted-foreground",
  growth:     "bg-primary/10 text-primary",
  enterprise: "bg-amber-400/10 text-amber-400",
};

const PLAN_ICON: Record<string, React.ElementType | null> = {
  starter:    null,
  growth:     Zap,
  enterprise: Crown,
};

interface Props {
  orgName:        string;
  plan:           "starter" | "growth" | "enterprise";
  userEmail:      string;
  userRole:       string;
  activeProducts: string[];
}

export function TenantSidebar({ orgName, plan, userEmail, userRole, activeProducts }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const features = useFeatures();
  const [changingPassword, setChangingPassword] = useState(false);

  const active = new Set(activeProducts);
  const isVisible = (m: NavModule) =>
    (!m.feature || features[m.feature])
    && (userRole === "admin" || (!m.adminOnly && (!m.roles || m.roles.includes(userRole))));

  // One entry per active product the role can use; hide products with nothing to show.
  const products = PRODUCTS
    .filter((p) => active.has(p.key) && canAccessTenantArea(userRole, { area: PRODUCT_AREA[p.key as ProductKey] }))
    .map((p) => ({ key: p.key, name: p.shortName, items: PRODUCT_MODULES[p.key as ProductKey].filter(isVisible) }))
    .filter((s) => s.items.length > 0);

  // Rediseño 2026: con más de un producto, un selector arriba y solo el menú del
  // producto actual (el de la ruta; en rutas de plataforma, el primero).
  const routeProduct = productForPath(pathname);
  const current = products.find((p) => p.key === routeProduct) ?? products[0];
  const sections = current
    ? [
        { name: "", items: current.items.filter((m) => m.group !== "config") },
        { name: "Configuración", items: current.items.filter((m) => m.group === "config") },
      ].filter((s) => s.items.length > 0)
    : [];

  const platformItems = PLATFORM_MODULES.filter(isVisible);

  // Highlight only the most specific matching route (longest href prefix), so a
  // parent like "/contracts" doesn't stay active on "/contracts/flow".
  // Rutas que viven dentro de otra entrada del menú (carga y detalle → Documentos).
  const navPath = pathname.startsWith("/workflow") || pathname.startsWith("/history") ? "/documents" : pathname;
  const allHrefs = [...sections.flatMap((s) => s.items), ...platformItems].map((m) => m.href);
  const activeHref = allHrefs
    .filter((h) => navPath === h || navPath.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-56 bg-card border-r border-border flex flex-col z-40">
      {/* Marca / Org */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-border shrink-0">
        <div className="w-8 h-8 shrink-0 flex items-center justify-center">
          <Image src="/logo-icon.png" alt="DocuIA" width={32} height={32} className="object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold tracking-[-0.01em] text-foreground truncate">{orgName}</p>
          {(() => {
            const PlanIcon = PLAN_ICON[plan];
            return (
              <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm", PLAN_BADGE[plan])}>
                {PlanIcon && <PlanIcon className="w-2.5 h-2.5" />}
                {plan}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Selector de producto (solo con más de uno) */}
      {products.length > 1 && (
        <div role="group" aria-label="Producto" className="mx-2 mt-3 grid gap-0.5 rounded-[9px] bg-secondary p-[3px]" style={{ gridTemplateColumns: `repeat(${products.length}, minmax(0, 1fr))` }}>
          {products.map((p) => {
            const on = p.key === current?.key;
            return (
              <Link
                key={p.key}
                href={p.items[0].href}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex min-h-[30px] items-center justify-center rounded-[7px] px-1 text-[11.5px] transition-all duration-[120ms]",
                  on ? "bg-card font-semibold text-foreground shadow-sm" : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {p.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Navegación del producto actual */}
      <nav className="flex-1 px-2 py-3 space-y-3 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.name || "main"} className="space-y-0.5">
            {section.name && (
              <p className="px-[10px] pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">
                {section.name}
              </p>
            )}
            {section.items.map((m) => {
              const Icon = ICONS[m.icon] ?? FolderOpen;
              const isActive = m.href === activeHref;
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={cn(
                    "flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs transition-all duration-[120ms]",
                    isActive
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{m.label}</span>
                </Link>
              );
            })}
          </div>
        ))}

        {/* Plataforma (siempre) */}
        <div className="space-y-0.5 pt-2 border-t border-border/60">
          {platformItems.map((m) => {
            const Icon = ICONS[m.icon] ?? Settings;
            const isActive = pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={cn(
                  "flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs transition-all duration-[120ms]",
                  isActive
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{m.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Usuario */}
      <div className="border-t border-border p-2 space-y-0.5 shrink-0">
        <div className="flex items-center gap-2.5 px-[10px] py-2 rounded-md bg-secondary/60">
          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{userEmail}</p>
            <p className="text-[10px] text-muted-foreground">{isTenantRole(userRole) ? TENANT_ROLE_LABELS[userRole] : userRole}</p>
          </div>
        </div>
        <button
          onClick={() => setChangingPassword(true)}
          className="w-full flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-[120ms]"
        >
          <KeyRound className="w-3.5 h-3.5 shrink-0" />
          Cambiar contraseña
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-[120ms]"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Cerrar sesión
        </button>
      </div>
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} userEmail={userEmail} />
    </aside>
  );
}
