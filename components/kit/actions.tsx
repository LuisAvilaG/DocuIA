import Link from "next/link";
import { cn } from "@/lib/utils";

export type BtnVariant = "primary" | "secondary" | "danger" | "text";
export type BtnSize = "md" | "sm";

const VARIANT: Record<BtnVariant, string> = {
  primary:   "bg-primary text-primary-foreground hover:bg-link",
  secondary: "bg-card text-foreground border-[#D6D2C8] hover:bg-secondary/60",
  danger:    "bg-card text-tone-err border-[#E9C6C2] hover:bg-tone-err-bg",
  text:      "bg-transparent text-muted-foreground hover:text-foreground",
};

/** Clases de botón del rediseño (40 px, o 34 px en `sm`). Sirve para <button> y <Link>. */
export function btn(variant: BtnVariant = "primary", size: BtnSize = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent font-semibold leading-none transition-colors",
    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    size === "md" ? "min-h-10 px-4 text-[13.5px]" : "min-h-[34px] px-3 text-[13px]",
    VARIANT[variant],
    className,
  );
}

/** Enlace con forma de botón. */
export function ActionLink({ href, variant = "primary", size = "md", className, children, ...rest }: {
  href: string; variant?: BtnVariant; size?: BtnSize; className?: string; children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  return <Link href={href} className={btn(variant, size, className)} {...rest}>{children}</Link>;
}

/** Pestañas de vista (filtros de una lista) con conteo opcional. */
export function ViewTabs({ items, className }: {
  items: { key: string; label: string; count?: number; href?: string; active?: boolean; onSelect?: () => void }[];
  className?: string;
}) {
  return (
    <nav aria-label="Vistas" className={cn("flex flex-wrap items-end gap-0.5 border-b border-border", className)}>
      {items.map((i) => {
        const cls = cn(
          "-mb-px border-b-2 px-3 py-2.5 text-[13.5px] transition-colors",
          i.active ? "border-foreground font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
        );
        const body = <>{i.label}{i.count !== undefined && <span className="ml-1.5 text-[12.5px] font-medium text-muted-foreground tabular-nums">{i.count.toLocaleString("es-MX")}</span>}</>;
        return i.href
          ? <Link key={i.key} href={i.href} className={cls} aria-current={i.active ? "page" : undefined}>{body}</Link>
          : <button key={i.key} type="button" onClick={i.onSelect} className={cls} aria-pressed={i.active}>{body}</button>;
      })}
    </nav>
  );
}
