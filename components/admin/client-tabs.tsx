"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "",          label: "Expediente" },
  { href: "/features", label: "Productos y features" },
  { href: "/users",    label: "Usuarios" },
  { href: "/erp",      label: "Conexión ERP", erpOnly: true },
  { href: "/usage",    label: "Uso" },
  { href: "/activity", label: "Actividad" },
];

export function ClientTabs({ orgId, showErp, erpPending }: { orgId: string; showErp: boolean; erpPending: boolean }) {
  const pathname = usePathname();
  const base = `/admin/clients/${orgId}`;
  return (
    <nav aria-label="Secciones del cliente" className="flex gap-6 border-b border-border overflow-x-auto">
      {TABS.filter((t) => !t.erpOnly || showErp).map((t) => {
        const href = base + t.href;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={t.href} href={href} aria-current={active ? "page" : undefined}
            className={cn("pb-2.5 -mb-px text-[13px] font-medium whitespace-nowrap border-b-2 inline-flex items-center gap-1.5", active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
            {t.erpOnly && erpPending && <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.70_0.14_80)]" aria-label="pendiente" />}
          </Link>
        );
      })}
    </nav>
  );
}
