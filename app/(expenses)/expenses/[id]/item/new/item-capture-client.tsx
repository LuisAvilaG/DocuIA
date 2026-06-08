"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Camera, Upload, FileText, AlertCircle, Loader2, CheckCircle2,
  ChevronDown, Calendar,
} from "lucide-react";
import { calculateTaxes } from "@/lib/expense/tax-engine";
import type { ExpenseOcrResult } from "@/lib/expense/extract";

// ── Types ──────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  netsuiteCategoryId: string;
  dailyCap: string | null;
}
interface CatalogItem { id: number; name: string; }
interface Warning { type: string; message: string; }

interface Props {
  reportId:      string;
  reportPurpose: string;
  categories:    Category[];
  departments:   CatalogItem[];
  classes:       CatalogItem[];
}

type Step = "capture" | "uploading" | "review" | "submitting";

// ── Constants ──────────────────────────────────────────────────────────

const DOC_LABELS: Record<string, string> = {
  invoice:               "Factura",
  receipt:               "Recibo / Ticket",
  cuenta_cobro:          "Cuenta de cobro",
  documento_equivalente: "Documento equivalente",
  unknown:               "Sin determinar",
};

const TIPS = [
  "Coloca el documento en una superficie plana con buena iluminación",
  "Encuadra todo el documento dentro de la foto",
  "Evita reflejos y sombras sobre el texto",
  "Mantén el celular paralelo al documento, sin ángulo",
];

const RETENTION_TYPES = new Set(["RETEFUENTE", "RETEICA", "ISR_RETENCION", "RETEIVA"]);

// ── Component ──────────────────────────────────────────────────────────

export function ItemCaptureClient({ reportId, reportPurpose, categories, departments, classes }: Props) {
  const router = useRouter();

  const [step,    setStep]    = useState<Step>("capture");
  const [error,   setError]   = useState<string | null>(null);
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [ocr,     setOcr]     = useState<ExpenseOcrResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Form fields
  const [vendorName,      setVendorName]      = useState("");
  const [vendorNit,       setVendorNit]       = useState("");
  const [invoiceNumber,   setInvoiceNumber]   = useState("");
  const [invoiceDate,     setInvoiceDate]     = useState("");
  const [subtotal,        setSubtotal]        = useState("");
  const [taxAmount,       setTaxAmount]       = useState("");
  const [retentionAmount, setRetentionAmount] = useState("");
  const [total,           setTotal]           = useState("");
  const [currency,        setCurrency]        = useState("COP");
  const [categoryId,      setCategoryId]      = useState("");
  const [departmentId,    setDepartmentId]    = useState("");
  const [classId,         setClassId]         = useState("");
  const [paymentMethod,   setPaymentMethod]   = useState<"personal" | "company_pays_vendor">("personal");
  const [description,     setDescription]     = useState("");
  const [warnings,        setWarnings]        = useState<Warning[]>([]);

  const cameraRef    = useRef<HTMLInputElement>(null);
  const fileRef      = useRef<HTMLInputElement>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate form from OCR result
  useEffect(() => {
    if (!ocr) return;
    setVendorName(ocr.vendorName ?? "");
    setVendorNit(ocr.vendorNit ?? "");
    setInvoiceNumber(ocr.invoiceNumber ?? "");
    setInvoiceDate(ocr.invoiceDate ?? "");
    setSubtotal(ocr.subtotal != null ? String(ocr.subtotal) : "");
    setTaxAmount(ocr.taxAmount != null ? String(ocr.taxAmount) : "");
    setRetentionAmount(ocr.retentionAmount != null ? String(ocr.retentionAmount) : "");
    setTotal(ocr.total != null ? String(ocr.total) : "");
    setCurrency(ocr.currency || "COP");
  }, [ocr]);

  // Auto-recompute total when amounts change
  useEffect(() => {
    const s = parseFloat(subtotal) || 0;
    const t = parseFloat(taxAmount) || 0;
    const r = parseFloat(retentionAmount) || 0;
    if (s > 0) setTotal(String(parseFloat((s + t - r).toFixed(2))));
  }, [subtotal, taxAmount, retentionAmount]);

  // Debounced validation
  useEffect(() => {
    if (step !== "review") return;
    if (validateTimer.current) clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(async () => {
      if (!vendorNit && !invoiceNumber && !subtotal && !categoryId) return;
      try {
        const res = await fetch("/api/v1/expenses/validate", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorNit:     vendorNit || undefined,
            invoiceNumber: invoiceNumber || undefined,
            subtotal:      parseFloat(subtotal) || undefined,
            categoryId:    categoryId ? Number(categoryId) : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setWarnings(data.warnings ?? []);
        }
      } catch { /* silent — non-blocking */ }
    }, 800);
    return () => { if (validateTimer.current) clearTimeout(validateTimer.current); };
  }, [vendorNit, invoiceNumber, subtotal, categoryId, step]);

  // Client-side tax preview
  const taxPreview = (() => {
    const s = parseFloat(subtotal);
    if (!s || !ocr?.documentType) return null;
    try {
      return calculateTaxes({
        countryCode:  "CO",
        documentType: ocr.documentType,
        subtotal:     s,
        categoryId:   categoryId || undefined,
      });
    } catch { return null; }
  })();

  // Field confidence helpers
  const fc = (key: string) => ocr?.fieldConfidence?.[key] ?? 1;
  const lowConf = (key: string) => fc(key) < 0.6;

  // File upload + OCR
  async function handleFile(file: File) {
    setError(null);
    if (file.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
    setStep("uploading");
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await fetch("/api/v1/expenses/ocr", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al procesar el documento"); setStep("capture"); return; }
      setFileKey(data.fileKey);
      setOcr(data.ocr);
      setStep("review");
    } catch {
      setError("No se pudo conectar con el servidor");
      setStep("capture");
    }
  }

  // Skip OCR — go directly to manual form
  function skipToManual() {
    setOcr(null);
    setFileKey(null);
    setPreview(null);
    setStep("review");
  }

  // Submit item
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!total || parseFloat(total) <= 0) { setError("Ingresa el total del documento"); return; }
    setError(null);
    setStep("submitting");
    try {
      const res = await fetch("/api/v1/expenses/items", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId,
          fileKey:         fileKey ?? undefined,
          documentTypeDetected: ocr?.documentType,
          vendorName:      vendorName || undefined,
          vendorNit:       vendorNit || undefined,
          invoiceNumber:   invoiceNumber || undefined,
          invoiceDate:     invoiceDate || undefined,
          subtotal:        subtotal ? parseFloat(subtotal) : undefined,
          taxAmount:       taxAmount ? parseFloat(taxAmount) : undefined,
          retentionAmount: retentionAmount ? parseFloat(retentionAmount) : undefined,
          total:           parseFloat(total),
          currency,
          categoryId:      Number(categoryId),
          departmentId:    departmentId ? Number(departmentId) : undefined,
          classId:         classId ? Number(classId) : undefined,
          paymentMethod,
          description:     description || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error al guardar el gasto"); setStep("review"); return; }
      router.push(`/expenses/${reportId}`);
    } catch {
      setError("No se pudo conectar con el servidor");
      setStep("review");
    }
  }

  // ── Capture step ───────────────────────────────────────────────────

  if (step === "capture" || step === "uploading") {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 border-b border-border">
          <a href={`/expenses/${reportId}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">← {reportPurpose}</a>
          <h1 className="text-base font-semibold text-foreground mt-2">Nuevo gasto</h1>
        </div>

        <div className="p-5 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {preview && (
            <div className="rounded-xl overflow-hidden border border-border">
              <img src={preview} alt="Vista previa" className="w-full max-h-48 object-cover" />
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Consejos para mejor lectura</p>
            <ul className="space-y-2.5">
              {TIPS.map((tip, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                  <span className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[0.625rem] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          {step === "uploading" ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Procesando documento con IA…</p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Camera className="w-5 h-5" />
                Tomar foto del documento
              </button>

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Subir imagen o PDF
              </button>

              <button
                type="button"
                onClick={skipToManual}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Ingresar datos manualmente
              </button>

              {/* Camera input — opens rear camera directly */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />

              {/* File picker — no camera constraint */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Review step ────────────────────────────────────────────────────

  const isSubmitting = step === "submitting";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-5 border-b border-border">
        <button
          type="button"
          onClick={() => { setStep("capture"); setError(null); setWarnings([]); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Nueva captura
        </button>
        <div className="flex items-center justify-between mt-2 gap-2">
          <h1 className="text-base font-semibold text-foreground">Revisar y guardar</h1>
          {ocr && (
            <span className={cn(
              "shrink-0 text-xs px-2 py-1 rounded-full font-medium",
              ocr.confidence >= 0.7 ? "bg-success/10 text-success" :
              ocr.confidence >= 0.4 ? "bg-warning/10 text-warning" :
                                      "bg-destructive/10 text-destructive",
            )}>
              OCR {Math.round(ocr.confidence * 100)}%
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-5 pb-36">

        {/* Global error */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Validation warnings */}
        {warnings.map((w) => (
          <div key={w.type} className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning">{w.message}</p>
          </div>
        ))}

        {/* Low confidence overall warning */}
        {ocr && ocr.confidence < 0.4 && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">La calidad del documento es baja. Verifica todos los campos antes de guardar.</p>
          </div>
        )}

        {/* Detected document type */}
        {ocr?.documentType && (
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Tipo detectado: <span className="font-medium text-foreground">{DOC_LABELS[ocr.documentType] ?? ocr.documentType}</span>
            </span>
          </div>
        )}

        {/* ── Proveedor ── */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proveedor</legend>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nombre del proveedor</label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="Ej: Restaurante El Buen Sabor"
              disabled={isSubmitting}
              className={cn(
                "w-full px-3 py-3 rounded-lg border text-base lg:text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60",
                lowConf("vendorName") ? "border-warning" : "border-border",
              )}
            />
            {lowConf("vendorName") && <p className="text-[0.625rem] text-warning">Verifica — confianza OCR baja</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">NIT / RFC</label>
            <input
              type="text"
              value={vendorNit}
              onChange={(e) => setVendorNit(e.target.value)}
              placeholder="Ej: 900123456-7"
              disabled={isSubmitting}
              className={cn(
                "w-full px-3 py-3 rounded-lg border text-base lg:text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60",
                lowConf("vendorNit") ? "border-warning" : "border-border",
              )}
            />
            {lowConf("vendorNit") && <p className="text-[0.625rem] text-warning">Verifica — confianza OCR baja</p>}
          </div>
        </fieldset>

        {/* ── Documento ── */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documento</legend>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground"># Factura / Recibo</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="FV-001234"
                disabled={isSubmitting}
                className={cn(
                  "w-full px-3 py-3 rounded-lg border text-base lg:text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60",
                  lowConf("invoiceNumber") ? "border-warning" : "border-border",
                )}
              />
              {lowConf("invoiceNumber") && <p className="text-[0.625rem] text-warning">Verifica</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Fecha del documento</label>
              <div className="relative">
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={isSubmitting}
                  className={cn(
                    "w-full appearance-none px-3 pr-8 py-2.5 rounded-lg border text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer",
                    lowConf("invoiceDate") ? "border-warning" : "border-border",
                  )}
                />
                <Calendar className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
              {lowConf("invoiceDate") && <p className="text-[0.625rem] text-warning">Verifica</p>}
            </div>
          </div>
        </fieldset>

        {/* ── Montos ── */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montos</legend>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Moneda</label>
            <div className="relative">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={isSubmitting}
                className="w-full appearance-none px-3 pr-8 py-3 rounded-lg border border-border text-base lg:text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                <option value="COP">COP — Peso colombiano</option>
                <option value="MXN">MXN — Peso mexicano</option>
                <option value="USD">USD — Dólar estadounidense</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Subtotal</label>
              <input
                type="text"
                inputMode="decimal"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                placeholder="0"
                disabled={isSubmitting}
                className={cn(
                  "w-full px-3 py-3 rounded-lg border text-base lg:text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60",
                  lowConf("subtotal") ? "border-warning" : "border-border",
                )}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Impuesto (IVA)</label>
              <input
                type="text"
                inputMode="decimal"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
                placeholder="0"
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Retención</label>
              <input
                type="text"
                inputMode="decimal"
                value={retentionAmount}
                onChange={(e) => setRetentionAmount(e.target.value)}
                placeholder="0"
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Total <span className="text-destructive">*</span></label>
              <input
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="0"
                required
                disabled={isSubmitting}
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg border text-sm bg-background text-foreground font-semibold placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60",
                  lowConf("total") ? "border-warning" : "border-primary/40",
                )}
              />
              {lowConf("total") && <p className="text-[0.625rem] text-warning">Verifica</p>}
            </div>
          </div>

          {/* Tax engine preview */}
          {taxPreview && taxPreview.taxes.length > 0 && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1.5">
              <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Impuestos calculados (referencia)
              </p>
              {taxPreview.taxes.map((t) => (
                <div key={t.type} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t.type} {(t.rate * 100).toFixed(0)}%</span>
                  <span className={cn("tabular-nums font-medium", RETENTION_TYPES.has(t.type) ? "text-warning" : "text-foreground")}>
                    {RETENTION_TYPES.has(t.type) ? "−" : "+"}
                    {t.amount.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border">
                <span className="font-medium text-foreground">Total estimado</span>
                <span className="tabular-nums font-semibold text-foreground">
                  {taxPreview.total.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}
        </fieldset>

        {/* ── Clasificación ── */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clasificación</legend>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Categoría</label>
            {categories.length === 0 ? (
              <p className="text-xs text-warning py-2 px-3 rounded-lg bg-warning/10 border border-warning/20">
                Sin categorías cargadas — el administrador debe sincronizarlas desde NetSuite. Puedes guardar el gasto sin categoría.
              </p>
            ) : (
              <div className="relative">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full appearance-none px-3 pr-8 py-3 rounded-lg border border-border text-base lg:text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>

          {departments.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Departamento</label>
              <div className="relative">
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full appearance-none px-3 pr-8 py-3 rounded-lg border border-border text-base lg:text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value="">Sin departamento</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          )}

          {classes.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Clase / Unidad de negocio</label>
              <div className="relative">
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full appearance-none px-3 pr-8 py-3 rounded-lg border border-border text-base lg:text-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value="">Sin clase</option>
                  {classes.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Forma de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "personal",             label: "Pago personal" },
                { value: "company_pays_vendor",  label: "Empresa → Proveedor" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setPaymentMethod(opt.value)}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-60",
                    paymentMethod === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {paymentMethod === "company_pays_vendor" && ocr?.documentType === "invoice" && (
              <p className="text-[0.625rem] text-primary">
                Se creará como Factura de Proveedor en NetSuite
              </p>
            )}
          </div>
        </fieldset>

        {/* ── Descripción ── */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Descripción (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Ej: Almuerzo con cliente — visita Medellín"
            disabled={isSubmitting}
            className="w-full px-3 py-2.5 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-60"
          />
        </div>
      </form>

      {/* Sticky footer */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-card border-t border-border px-4 pt-4 max-w-lg mx-auto"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          type="button"
          disabled={isSubmitting || !total || parseFloat(total) <= 0}
          onClick={handleSubmit}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
          ) : (
            <><CheckCircle2 className="w-4 h-4" /> Guardar gasto</>
          )}
        </button>
      </div>
    </div>
  );
}
