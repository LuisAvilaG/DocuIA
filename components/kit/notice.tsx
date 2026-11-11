import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type NoticeTone = "warn" | "err" | "ok" | "info";

const STYLE: Record<NoticeTone, { box: string; icon: string; Icon: React.ElementType }> = {
  warn: { box: "border-[#EBD9AE] bg-[#FFFBF2]", icon: "text-tone-warn", Icon: AlertTriangle },
  err:  { box: "border-[#EBCFCB] bg-[#FDF6F5]", icon: "text-tone-err", Icon: XCircle },
  ok:   { box: "border-[#CDE6D8] bg-[#F1F8F4]", icon: "text-tone-ok", Icon: CheckCircle2 },
  info: { box: "border-[#C9DCF0] bg-[#EEF4FB]", icon: "text-tone-blue", Icon: Info },
};

/**
 * Aviso de una sola idea. Regla del rediseño: como mucho un aviso ámbar por pantalla.
 * `title` es la frase que importa; `children` la explicación corta.
 */
export function Notice({ tone = "warn", title, children, action, className }: {
  tone?: NoticeTone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const s = STYLE[tone];
  return (
    <div role={tone === "err" ? "alert" : "note"} className={cn("flex items-start gap-3 rounded-[10px] border px-4 py-3 text-[13.5px]", s.box, className)}>
      <s.Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", s.icon)} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        {children && <div className="mt-0.5 text-foreground/85">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
