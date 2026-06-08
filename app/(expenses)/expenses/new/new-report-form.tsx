"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Calendar } from "lucide-react";

export function NewReportForm() {
  const router = useRouter();
  const [purpose,     setPurpose]     = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd,   setPeriodEnd]   = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!purpose.trim()) { setError("El propósito es requerido"); return; }
    setLoading(true);
    setError(null);

    const res = await fetch("/api/v1/expenses/reports", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ purpose, periodStart: periodStart || undefined, periodEnd: periodEnd || undefined }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error ?? "Error al crear el informe"); return; }
    router.push(`/expenses/${data.reportId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="purpose" className="text-sm">Propósito del informe <span className="text-destructive">*</span></Label>
        <Input
          id="purpose"
          placeholder="Ej: Visita cliente Medellín — mayo 2026"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className="text-sm"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">Describe brevemente el motivo de estos gastos.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="periodStart" className="text-sm">Desde</Label>
          <div className="relative">
            <Input
              id="periodStart"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="text-sm appearance-none pr-8 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periodEnd" className="text-sm">Hasta</Label>
          <div className="relative">
            <Input
              id="periodEnd"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="text-sm appearance-none pr-8 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
            <Calendar className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading || !purpose.trim()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Crear informe
      </button>
    </form>
  );
}
