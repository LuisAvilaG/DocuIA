import { ViewTabs } from "@/components/kit";

/** Las dos pantallas del mapa de aprobaciones: los mapas y quién firma en cada rol. */
export function ApprovalMapTabs({ active, className }: { active: "maps" | "roles"; className?: string }) {
  return (
    <ViewTabs className={className} items={[
      { key: "maps", label: "Mapas", href: "/contracts/approval-maps", active: active === "maps" },
      { key: "roles", label: "Roles y personas", href: "/contracts/approval-maps/roles", active: active === "roles" },
    ]} />
  );
}
