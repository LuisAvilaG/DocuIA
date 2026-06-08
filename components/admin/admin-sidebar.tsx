"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Building2, Settings, LogOut, Cpu,
} from "lucide-react";
import Image from "next/image";

const NAV = [
  { href: "/admin",          label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/clients",  label: "Clientes",  icon: Building2 },
  { href: "/admin/features", label: "Features",  icon: Cpu },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router   = useRouter();

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-56 flex flex-col z-40"
      style={{
        backgroundColor: "oklch(0.22 0.10 240)",
        borderRight: "1px solid oklch(0.30 0.09 240)",
      }}
    >
      {/* Logo */}
      <div
        className="h-14 flex items-center gap-2.5 px-4 shrink-0"
        style={{ borderBottom: "1px solid oklch(0.30 0.09 240)" }}
      >
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <Image
            src="/logo-icon.png"
            alt="DocuIA"
            width={28}
            height={28}
            className="object-contain"
          />
        </div>
        <div className="leading-none">
          <p className="text-sm font-semibold" style={{ color: "oklch(0.92 0.004 240)" }}>
            DocuIA
          </p>
          <p
            className="text-[10px] font-medium uppercase tracking-widest mt-0.5"
            style={{ color: "oklch(0.65 0.14 182)" }}
          >
            Admin
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <p
          className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "oklch(0.48 0.007 240)" }}
        >
          Plataforma
        </p>
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-[120ms] group",
                active
                  ? "bg-[oklch(0.30_0.09_240)]"
                  : "hover:bg-[oklch(0.28_0.09_240)]"
              )}
              style={{
                color: active
                  ? "oklch(0.65 0.14 182)"
                  : "oklch(0.68 0.009 240)",
              }}
            >
              <Icon
                className="w-4 h-4 shrink-0 transition-colors duration-[120ms]"
                style={{
                  color: active
                    ? "oklch(0.65 0.14 182)"
                    : "oklch(0.55 0.009 240)",
                }}
              />
              <span className="flex-1">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div
        className="px-2 py-3 space-y-0.5 shrink-0"
        style={{ borderTop: "1px solid oklch(0.30 0.09 240)" }}
      >
        <Link
          href="/admin/settings"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-[120ms] hover:bg-[oklch(0.28_0.09_240)]"
          style={{ color: "oklch(0.55 0.009 240)" }}
        >
          <Settings className="w-4 h-4" style={{ color: "oklch(0.48 0.008 240)" }} />
          Configuración
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-[120ms] hover:bg-[oklch(0.50_0.20_25_/_0.12)]"
          style={{ color: "oklch(0.55 0.009 240)" }}
        >
          <LogOut className="w-4 h-4" style={{ color: "oklch(0.48 0.008 240)" }} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
