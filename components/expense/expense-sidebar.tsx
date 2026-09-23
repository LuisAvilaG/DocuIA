"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { canReviewExpenses, isTenantRole, TENANT_ROLE_LABELS } from "@/lib/auth/permissions";
import { PlusCircle, ClipboardList, LogOut, User, KeyRound, X, Menu } from "lucide-react";
import Image from "next/image";
import { ChangePasswordDialog } from "@/components/shared/change-password-dialog";

interface Props {
  orgName:   string;
  userEmail: string;
  userRole:  string;
}

const NAV_ITEMS = [
  { href: "/expenses",      label: "Mis gastos",    icon: ClipboardList },
  { href: "/expenses/new",  label: "Nuevo informe", icon: PlusCircle },
];

const ACCOUNTING_ITEMS = [
  { href: "/accounting/expenses", label: "Revisión de gastos", icon: ClipboardList },
];

export function ExpenseSidebar({ orgName, userEmail, userRole }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  const [open,          setOpen]          = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);

  function closeDrawer() { setOpen(false); }

  function openChangePwd() { setShowChangePwd(true); }


  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isReviewer = canReviewExpenses(userRole);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-40 lg:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Abrir menú"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Backdrop (mobile only) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-[oklch(0.18_0.015_258)]/60 lg:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed left-0 top-0 h-full w-56 bg-card border-r border-border flex flex-col z-40",
        "transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}>
        {/* Logo + mobile close */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Image src="/logo-icon.png" alt="DocuIA" width={28} height={28} className="rounded shrink-0" />
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-semibold text-foreground truncate">{orgName}</p>
              <p className="text-[0.6875rem] text-muted-foreground">Gastos</p>
            </div>
          </div>
          <button
            onClick={closeDrawer}
            className="lg:hidden p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Cerrar menú"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] px-2 py-1.5">
            Mis gastos
          </p>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/expenses" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={closeDrawer}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-3 lg:py-2 rounded-lg text-[0.8125rem] transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}

          {isReviewer && (
            <>
              <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] px-2 py-1.5 mt-3">
                Contabilidad
              </p>
              {ACCOUNTING_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeDrawer}
                    className={cn(
                      "flex items-center gap-2.5 px-2.5 py-3 lg:py-2 rounded-lg text-[0.8125rem] transition-colors",
                      active
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 px-1 mb-2">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[0.75rem] text-foreground truncate">{userEmail}</p>
              <p className="text-[0.6875rem] text-muted-foreground">
                {isTenantRole(userRole) ? TENANT_ROLE_LABELS[userRole] : userRole}
              </p>
            </div>
          </div>
          <button
            onClick={openChangePwd}
            className="flex items-center gap-2 px-2 py-2.5 lg:py-1.5 w-full rounded-lg text-[0.8125rem] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            Cambiar contraseña
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-2 py-2.5 lg:py-1.5 w-full rounded-lg text-[0.8125rem] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Cerrar sesión
          </button>
        </div>

        <ChangePasswordDialog open={showChangePwd} onClose={() => setShowChangePwd(false)} userEmail={userEmail} />
      </aside>
    </>
  );
}
