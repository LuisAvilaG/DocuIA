"use client";

import { usePathname } from "next/navigation";
import { AdminRail } from "./admin-rail";
import { SessionRefresh } from "@/components/providers/session-refresh";

export function AdminLayoutClient({ children, adminInitials }: { children: React.ReactNode; adminInitials: string }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <SessionRefresh realm="admin" />
      <AdminRail adminInitials={adminInitials} />
      {/* Every page renders its own panel + content inside this flex row. */}
      <div className="ml-16 min-h-screen flex items-stretch">
        {children}
      </div>
    </div>
  );
}
