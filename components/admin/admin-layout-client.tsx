"use client";

import { usePathname } from "next/navigation";
import { AdminSidebar } from "./admin-sidebar";
import { SessionRefresh } from "@/components/providers/session-refresh";

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <SessionRefresh realm="admin" />
      <AdminSidebar />
      <main className="flex-1 ml-56 min-h-screen flex flex-col">
        {children}
      </main>
    </div>
  );
}
