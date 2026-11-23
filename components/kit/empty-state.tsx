import { cn } from "@/lib/utils";

/** Estado vacío: qué pasó, por qué y qué hacer. Sin ilustraciones decorativas. */
export function EmptyState({ icon: Icon, title, children, actions, className }: {
  icon?: React.ElementType;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2.5 rounded-xl border border-border bg-card px-6 py-14 text-center", className)}>
      {Icon && <Icon aria-hidden className="size-5 text-muted-foreground" />}
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="mt-1.5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
