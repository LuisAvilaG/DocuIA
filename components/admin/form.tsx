"use client";

import { useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { CalendarDays, Check, ChevronDown, Copy, Eye, EyeOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Form vocabulary for the platform-admin screens. Every control shares the same
// box (white paper, hairline border, teal focus ring) so a form reads as one
// piece whatever mix of inputs it holds.

export const control = "w-full bg-white border border-border rounded-lg px-3 py-[9px] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)] disabled:opacity-50 disabled:cursor-not-allowed";

export function Field({ label, hint, error, children, className, optional }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; optional?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium tracking-[0.06em] uppercase text-muted-foreground">{label}</span>
        {optional && <span className="text-[11px] text-muted-foreground/70">opcional</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-muted-foreground leading-relaxed">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cn(control, invalid && "border-destructive focus:border-destructive focus:shadow-[0_0_0_3px_oklch(0.55_0.20_25_/_0.12)]", className)} {...props} />;
}

/** Input with a fixed prefix (a domain, a currency symbol) drawn inside the box. */
export function PrefixedInput({ prefix, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { prefix: ReactNode }) {
  return (
    <span className={cn("flex items-stretch bg-white border border-border rounded-lg overflow-hidden transition-[border-color,box-shadow] duration-[120ms] focus-within:border-primary focus-within:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]", className)}>
      <span className="flex items-center pl-3 pr-2 text-sm text-muted-foreground bg-secondary/60 border-r border-border whitespace-nowrap select-none">{prefix}</span>
      <input className="flex-1 min-w-0 px-3 py-[9px] text-sm bg-transparent outline-none placeholder:text-muted-foreground/50" {...props} />
    </span>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(control, "appearance-none pr-9 cursor-pointer", className)} {...props}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function DateInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="relative block">
      <input type="date" className={cn(control, "pr-10 cursor-pointer tabular-nums [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer", className)} {...props} />
      <CalendarDays className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function generatePassword(length = 14): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Password box with show/hide and, when `onGenerate` is given, a generator and a copy button. */
export function PasswordInput({ value, onChange, onGenerate, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string; onChange: (v: string) => void; onGenerate?: () => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }
  return (
    <span className="flex items-center gap-2">
      <span className="relative flex-1 min-w-0">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} className={cn(control, "pr-10 font-mono tracking-wide", className)} {...props} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} tabIndex={-1} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </span>
      {onGenerate && (
        <button type="button" onClick={() => { onGenerate(); setShow(true); }} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg px-2.5 py-2 hover:bg-primary/5">
          <Sparkles className="w-3.5 h-3.5" /> Generar
        </button>
      )}
      {onGenerate && value && (
        <button type="button" onClick={copy} aria-label="Copiar contraseña" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary">
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
    </span>
  );
}

/** Radio-style cards for a short list of mutually exclusive options (plan, environment). */
export function ChoiceCards<T extends string>({ value, onChange, options, columns = 3, className }: {
  value: T; onChange: (v: T) => void; columns?: number; className?: string;
  options: Array<{ value: T; label: ReactNode; description?: ReactNode; meta?: ReactNode }>;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-3", className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cn("text-left rounded-xl border bg-white px-4 py-3.5 flex flex-col gap-1 transition-[border-color,box-shadow]", on ? "border-primary shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.10)]" : "border-border hover:border-foreground/30")}>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{o.label}</span>
              <span className={cn("w-4 h-4 rounded-full border-[1.5px] inline-flex items-center justify-center", on ? "border-primary" : "border-border")}>{on && <span className="w-2 h-2 rounded-full bg-primary" />}</span>
            </span>
            {o.description && <span className="text-xs text-muted-foreground leading-relaxed">{o.description}</span>}
            {o.meta && <span className="text-[11px] text-muted-foreground/80 mt-0.5">{o.meta}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "America/Mexico_City", label: "Ciudad de México (UTC−6)" },
  { value: "America/Monterrey", label: "Monterrey (UTC−6)" },
  { value: "America/Cancun", label: "Cancún (UTC−5)" },
  { value: "America/Tijuana", label: "Tijuana (UTC−8/−7)" },
  { value: "America/Hermosillo", label: "Hermosillo (UTC−7)" },
  { value: "America/Guatemala", label: "Guatemala (UTC−6)" },
  { value: "America/Bogota", label: "Bogotá (UTC−5)" },
  { value: "America/Lima", label: "Lima (UTC−5)" },
  { value: "America/Santiago", label: "Santiago (UTC−4/−3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (UTC−3)" },
  { value: "America/Sao_Paulo", label: "São Paulo (UTC−3)" },
  { value: "America/New_York", label: "Nueva York (UTC−5/−4)" },
  { value: "America/Chicago", label: "Chicago (UTC−6/−5)" },
  { value: "America/Denver", label: "Denver (UTC−7/−6)" },
  { value: "America/Los_Angeles", label: "Los Ángeles (UTC−8/−7)" },
  { value: "Europe/Madrid", label: "Madrid (UTC+1/+2)" },
  { value: "UTC", label: "UTC" },
];

export function TimezoneSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const known = TIMEZONES.some((t) => t.value === value);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {!known && value && <option value={value}>{value}</option>}
      {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
    </Select>
  );
}
