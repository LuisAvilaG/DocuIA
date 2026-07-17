import { AdminLayoutClient } from "@/components/admin/admin-layout-client";

// Admin pages are session-gated and read live data from the DB per request;
// never prerender them at build (avoids build-time DB calls + stale HTML).
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
