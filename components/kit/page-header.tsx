import Link from "next/link";
import { cn } from "@/lib/utils";

interface Crumb { href: string; label: string }

/** Encabezado de página: ruta opcional, antetítulo, título, descripción y acciones a la derecha. */
export function PageHeader({
  eyebrow, title, description, actions, crumbs, className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0 max-w-3xl">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Ruta" className="mb-1 text-[13px] text-muted-foreground">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && <span aria-hidden> / </span>}
                <Link href={c.href} className="text-link hover:underline">{c.label}</Link>
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.06em] text-link">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Título de sección con regla fina debajo y un dato a la derecha. */
export function SectionTitle({ title, aside, className }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b border-foreground pb-2", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {aside && <span className="text-[12.5px] text-muted-foreground">{aside}</span>}
    </div>
  );
}
