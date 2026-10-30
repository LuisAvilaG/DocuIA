import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/admin";
import { getTodayMonitor } from "@/lib/admin/monitor";
import { MonitorView } from "./monitor-view";

export default async function AdminHomePage() {
  if ((await requireAdminSession()).error) redirect("/admin/login");
  let data = null;
  try {
    data = await getTodayMonitor();
  } catch (err) {
    console.error("[admin/home] monitor failed", err);
  }
  return <MonitorView initial={data} />;
}
