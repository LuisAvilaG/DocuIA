import { cn } from "@/lib/utils";

/**
 * Marco de página del rediseño: área con scroll propio y contenido centrado.
 * `wide` para pantallas de trabajo (detalle de factura), por defecto 1120 px.
 */
export function PageFrame({ children, wide = false, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className="flex-1 overflow-auto">
      <main className={cn("mx-auto w-full px-6 pt-8 pb-14 md:px-11", wide ? "max-w-[1400px]" : "max-w-[1120px]", className)}>
        {children}
      </main>
    </div>
  );
}
