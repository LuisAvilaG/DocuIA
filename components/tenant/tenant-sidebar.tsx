"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FileUp, Clock, AlertTriangle,
  GitMerge, Database, BarChart3, Settings,
  LogOut, User, Zap, Crown, Receipt,
} from "lucide-react";
import Image from "next/image";
import { useFeature } from "@/components/providers/feature-provider";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: React.ElementType;
  feature?: string;
  adminOnly?: boolean;
}[] = [
  { href: "/dashboard",             label: "Dashboard",    icon: LayoutDashboard },
  { href: "/workflow",              label: "Workflow",      icon: FileUp },
  { href: "/history",              label: "Historial",     icon: Clock },
  { href: "/exceptions",           label: "Excepciones",   icon: AlertTriangle,  feature: "exception_queue" },
  { href: "/mappings",             label: "Mapeos",        icon: GitMerge,       feature: "auto_mapping" },
  { href: "/catalogs",             label: "Catálogos",     icon: Database },
  { href: "/accounting/expenses",  label: "Gastos",        icon: Receipt,        feature: "expense_management", adminOnly: true },
  { href: "/statistics",           label: "Estadísticas",  icon: BarChart3,      feature: "advanced_analytics" },
  { href: "/settings",             label: "Configuración", icon: Settings },
];

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

interface WhiteLabelConfig {
  companyName?:  string;
  logoUrl?:      string;
  hideBranding?: boolean;
}

interface Props {
  orgName:     string;
  plan:        "starter" | "growth" | "enterprise";
  userEmail:   string;
  userRole:    string;
  whiteLabel?: WhiteLabelConfig;
}

export function TenantSidebar({ orgName, plan, userEmail, userRole, whiteLabel }: Props) {
  const pathname = usePathname();
  const router   = useRouter();

  const exceptionQueue    = useFeature("exception_queue");
  const autoMapping       = useFeature("auto_mapping");
  const advancedAnalytics = useFeature("advanced_analytics");
  const expenseManagement = useFeature("expense_management");

  const featureMap: Record<string, boolean> = {
    exception_queue:    exceptionQueue,
    auto_mapping:       autoMapping,
    advanced_analytics: advancedAnalytics,
    expense_management: expenseManagement,
  };

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.feature && !featureMap[item.feature]) return false;
    if (item.adminOnly && userRole !== "admin") return false;
    return true;
  });

  const displayName = whiteLabel?.companyName || orgName;
  const showDocuIALogo = !whiteLabel?.hideBranding && !whiteLabel?.logoUrl;
  const customLogoUrl  = whiteLabel?.logoUrl;

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-56 bg-card border-r border-border flex flex-col z-40">
      {/* Marca / Org */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-border shrink-0">
        {(showDocuIALogo || customLogoUrl) && (
          <div className="w-8 h-8 shrink-0 flex items-center justify-center">
            <Image
              src={customLogoUrl ?? "/logo-icon.png"}
              alt={displayName}
              width={32}
              height={32}
              className="object-contain"
              unoptimized={!!customLogoUrl}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold tracking-[-0.01em] text-foreground truncate">{displayName}</p>
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

      {/* Navegación */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs transition-all duration-[120ms]",
                active
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Usuario */}
      <div className="border-t border-border p-2 space-y-0.5 shrink-0">
        <div className="flex items-center gap-2.5 px-[10px] py-2 rounded-md bg-secondary/60">
          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{userEmail}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{userRole}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-[10px] py-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-[120ms]"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
