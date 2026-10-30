"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Building2, Cpu, ShieldCheck, ScrollText, LogOut } from "lucide-react";

const NAV = [
  { href: "/admin",                label: "Resumen",               icon: LayoutDashboard, exact: true },
  { href: "/admin/clients",        label: "Clientes",              icon: Building2 },
  { href: "/admin/features",       label: "Catálogo de features",  icon: Cpu },
  { href: "/admin/administrators", label: "Administradores",       icon: ShieldCheck },
  { href: "/admin/audit",          label: "Auditoría",             icon: ScrollText },
];

/** 64 px navy icon rail: the only chrome shared by every platform screen. */
export function AdminRail({ adminInitials }: { adminInitials: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-y-0 left-0 z-40 w-16 flex flex-col items-center py-4 gap-1.5"
      style={{ backgroundColor: "oklch(0.22 0.10 240)", borderRight: "1px solid oklch(0.30 0.09 240)" }}
    >
      <Link href="/admin" aria-label="DocuIA" className="w-10 h-10 mb-2 rounded-xl flex items-center justify-center font-bold text-sm"
        style={{ backgroundColor: "oklch(0.65 0.14 182)", color: "oklch(0.22 0.10 240)" }}>
        D
      </Link>
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={cn("w-10 h-10 rounded-[10px] flex items-center justify-center transition-colors", active ? "bg-[oklch(0.30_0.09_240)]" : "hover:bg-[oklch(0.28_0.09_240)]")}
            style={{ color: active ? "oklch(0.65 0.14 182)" : "oklch(0.62 0.02 240)" }}
          >
            <Icon className="w-[18px] h-[18px]" />
          </Link>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        onClick={logout}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className="group w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-semibold relative"
        style={{ backgroundColor: "oklch(0.30 0.09 240)", color: "oklch(0.72 0.02 240)" }}
      >
        <span className="group-hover:opacity-0 transition-opacity">{adminInitials}</span>
        <LogOut className="w-4 h-4 absolute opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    </nav>
  );
}
