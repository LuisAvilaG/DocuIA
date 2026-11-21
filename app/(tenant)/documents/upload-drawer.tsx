"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, Drawer } from "@/components/kit";
import { friendlyError } from "@/lib/ap/friendly-error";
import { apStatus } from "@/lib/status-vocabulary";
import type { InvoiceFormat } from "@/lib/subsidiaries/invoice-format";

export interface UploadSubsidiary { id: string; name: string; invoiceFormat: InvoiceFormat; country: string | null }

type Kind = "invoice" | "purchase_order";
type ItemStatus = "pending" | "uploading" | "queued" | "uploaded" | "extracting" | "processing" | "approved"
  | "review" | "completed" | "pending_approval" | "awaiting_receipt" | "failed";

interface Item {
  key: string;
  file: File;
  pdf?: File;
  status: ItemStatus;
  docId?: number;
  error?: string;
  numDoc?: string | null;
  vendor?: string | null;
  total?: number | null;
  erpId?: string | null;
}

const BULK_MAX = 20;
// No TIFF: the models do not read it and the document ended "Con error".
const DOC_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
const XML_ACCEPT = ".xml,text/xml,application/xml";
const SETTLED = new Set<ItemStatus>(["review", "completed", "pending_approval", "awaiting_receipt", "failed"]);
const NEEDS = new Set<ItemStatus>(["review", "pending_approval", "awaiting_receipt", "failed"]);
const POLL_MS = 3000;
const POLL_LIMIT_MS = 4 * 60_000;

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").trim().toLowerCase();
const isXml = (f: File) => /\.xml$/i.test(f.name) || f.type === "text/xml" || f.type === "application/xml";
const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const ext = (f: File) => (f.name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const newKey = () => `f${++seq}`;

// UUID del timbre fiscal: empareja un XML con su PDF cuando el PDF lleva el UUID por nombre.
async function cfdiUuid(file: File): Promise<string | null> {
  try {
    const text = await file.slice(0, 200_000).text();
    const m = text.match(/TimbreFiscalDigital[^>]*?UUID="([0-9A-Fa-f-]{36})"/) ?? text.match(/UUID="([0-9A-Fa-f-]{36})"/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function formatHint(s: UploadSubsidiary): string {
  return s.invoiceFormat === "cfdi" ? "Facturas con CFDI: XML + PDF" : "Facturas en PDF o imagen · sin XML";
}

function reasonOf(it: Item, raw?: string | null): string {
  const errorMessage = friendlyError(raw);
  if (it.error) return friendlyError(it.error) ?? it.error;
  switch (it.status) {
    case "pending_approval": return errorMessage || "Espera aprobación";
    case "awaiting_receipt": return "Espera la entrada de almacén";
    default: return errorMessage || apStatus(it.status).label;
  }
}

export function UploadDrawer({ subsidiaries, bulkEnabled, onClose, onUploaded }: {
  subsidiaries: UploadSubsidiary[];
  bulkEnabled: boolean;
  onClose: () => void;
  /** Se llama al terminar un lote, para refrescar la lista. */
  onUploaded: () => void;
}) {
  const [subId, setSubId] = useState(subsidiaries[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("invoice");
  const [bulk, setBulk] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unpaired, setUnpaired] = useState<File[]>([]);
  const [phase, setPhase] = useState<"pick" | "run" | "done">("pick");
  const [reasons, setReasons] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const sub = subsidiaries.find((s) => s.id === subId) ?? null;
  const documentType = kind === "purchase_order" ? "purchase_order" : sub?.invoiceFormat === "cfdi" ? "xml_cfdi" : "invoice";
  const cfdi = documentType === "xml_cfdi";

  function reset(next?: Partial<{ kind: Kind; subId: string; bulk: boolean }>) {
    if (next?.kind) setKind(next.kind);
    if (next?.subId) setSubId(next.subId);
    if (next?.bulk !== undefined) setBulk(next.bulk);
    setItems([]); setUnpaired([]); setNotice("");
  }

  // ── Selección de archivos ────────────────────────────────────────────────
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setNotice("");
    if (!bulk) {
      if (cfdi) {
        const xml = incoming.find(isXml);
        const pdf = incoming.find(isPdf);
        const cur = items[0];
        if (xml || cur) { setItems([{ key: cur?.key ?? newKey(), file: xml ?? cur!.file, pdf: pdf ?? cur?.pdf ?? unpaired[0], status: "pending" }]); setUnpaired([]); }
        else if (pdf) setUnpaired([pdf]);
        return;
      }
      const f = incoming[0];
      if (f) setItems([{ key: newKey(), file: f, status: "pending" }]);
      return;
    }
    if (!cfdi) {
      const room = BULK_MAX - items.length;
      if (incoming.length > room) setNotice(`El lote admite ${BULK_MAX} archivos; se agregaron los primeros ${Math.max(room, 0)}.`);
      setItems([...items, ...incoming.slice(0, Math.max(room, 0)).map((file) => ({ key: newKey(), file, status: "pending" as const }))]);
      return;
    }
    // CFDI en lote: cada XML con el PDF del mismo nombre o con su UUID.
    const xmls = incoming.filter(isXml);
    const pdfs = [...unpaired, ...incoming.filter(isPdf)];
    const uuids = await Promise.all(xmls.map(cfdiUuid));
    const used = new Set<File>();
    const take = (keys: string[]) => {
      const found = pdfs.find((p) => !used.has(p) && keys.includes(baseName(p.name)));
      if (found) used.add(found);
      return found;
    };
    const updated = items.map((it) => (it.pdf ? it : { ...it, pdf: take([baseName(it.file.name)]) }));
    const room = BULK_MAX - updated.length;
    if (xmls.length > room) setNotice(`El lote admite ${BULK_MAX} facturas; se agregaron las primeras ${Math.max(room, 0)}.`);
    const added = xmls.slice(0, Math.max(room, 0)).map((file, i) => ({
      key: newKey(), file, status: "pending" as const,
      pdf: take([baseName(file.name), ...(uuids[i] ? [uuids[i] as string] : [])]),
    }));
    setItems([...updated, ...added]);
    setUnpaired(pdfs.filter((p) => !used.has(p)));
  }

  // ── Envío y seguimiento ──────────────────────────────────────────────────
  const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function run() {
    if (!sub || items.length === 0) return;
    setPhase("run");
    setSending(true);
    const queue = items;
    const docKeys = new Map<number, string>();
    for (const it of queue) {
      if (!alive.current) return;
      patch(it.key, { status: "uploading" });
      try {
        const fd = new FormData();
        fd.append("file", it.file);
        fd.append("subsidiaryId", sub.id);
        fd.append("documentType", documentType);
        if (bulk) fd.append("bulk", "true");
        if (cfdi && it.pdf) fd.append("pdf", it.pdf);
        const res = await fetch("/api/v1/workflow/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (data.documentId) docKeys.set(data.documentId, it.key);
        if (!res.ok) patch(it.key, { status: "failed", error: data.error ?? "No se pudo procesar", docId: data.documentId });
        else patch(it.key, { status: (data.status ?? "queued") as ItemStatus, docId: data.documentId });
      } catch {
        patch(it.key, { status: "failed", error: "Sin conexión con el servidor" });
      }
    }

    setSending(false);
    // Lo que quedó en cola se sigue hasta que llegue a un estado que ya no avanza solo.
    const started = Date.now();
    while (alive.current && Date.now() - started < POLL_LIMIT_MS) {
      const ids = [...docKeys.keys()];
      if (ids.length === 0) break;
      try {
        const res = await fetch(`/api/v1/workflow/status?ids=${ids.join(",")}`);
        if (res.ok) {
          const { documents } = await res.json() as { documents: Array<{ id: number; status: ItemStatus; vendor: string | null; numDoc: string | null; total: string | number | null; netsuiteDocId: string | null; errorMessage: string | null }> };
          const pendingIds: number[] = [];
          for (const d of documents) {
            const key = docKeys.get(d.id);
            if (!key) continue;
            patch(key, { status: d.status, vendor: d.vendor, numDoc: d.numDoc, total: d.total != null ? Number(d.total) : null, erpId: d.netsuiteDocId });
            setReasons((r) => ({ ...r, [key]: d.errorMessage }));
            if (!SETTLED.has(d.status)) pendingIds.push(d.id);
          }
          for (const id of ids) if (!pendingIds.includes(id)) docKeys.delete(id);
          if (pendingIds.length === 0) break;
        }
      } catch { /* reintenta en la siguiente vuelta */ }
      await sleep(POLL_MS);
    }
    // The list is refreshed even if the panel was closed meanwhile, as its
    // own text invites to do.
    if (alive.current) setPhase("done");
    onUploaded();
  }

  // ── Pantallas ────────────────────────────────────────────────────────────
  if (phase !== "pick") {
    const needs = items.filter((it) => NEEDS.has(it.status));
    const done = items.filter((it) => it.status === "completed");
    const running = items.filter((it) => !SETTLED.has(it.status));
    const first = needs.find((it) => it.docId);
    const n = items.length;
    const title = phase === "run"
      ? `Procesando ${n === 1 ? "el documento" : `${n} documentos`}`
      : n === 1 ? "Listo el documento" : `Listo el lote de ${n} documentos`;
    const summary = phase === "run"
      ? sending
        ? `Subiendo ${n === 1 ? "el archivo" : "los archivos"}. No cierres este panel hasta que terminen de subir.`
        : `${n - running.length} de ${n} terminados. Ya puedes cerrar este panel; el proceso sigue.`
      : [
          done.length ? `${done.length === n ? (n === 1 ? "Ya está" : "Todos están") : `${done.length} ya ${done.length === 1 ? "está" : "están"}`} en el ERP.` : "",
          needs.length ? `${needs.length === n ? (n === 1 ? "Necesita" : "Todos necesitan") : `Los otros ${needs.length} necesitan`} algo de ti.` : "",
          running.length ? `${running.length} sigue${running.length === 1 ? "" : "n"} en proceso; aparecerá${running.length === 1 ? "" : "n"} en Documentos.` : "",
        ].filter(Boolean).join(" ");
    return (
      <Drawer
        title={title}
        description={<span className="text-sm text-foreground">{summary}</span>}
        onClose={onClose}
        locked={sending}
        width={600}
        footer={phase === "done" && (
          <>
            <button type="button" className={btn("secondary")} onClick={() => { reset(); setReasons({}); setPhase("pick"); }}>Subir otro {bulk ? "lote" : "documento"}</button>
            {first ? <Link href={`/history/${first.docId}`} className={btn("primary")}>{first.status === "review" ? "Empezar a revisar" : "Ver el primero"}</Link>
              : <button type="button" className={btn("primary")} onClick={onClose}>Ver documentos</button>}
          </>
        )}
      >
        {running.length > 0 && (
          <section>
            <Label>{phase === "run" ? "En proceso" : "Siguen en proceso"}</Label>
            {running.map((it) => <ResultRow key={it.key} mark="run" title={it.file.name} sub={it.status === "pending" ? "En espera" : it.status === "uploading" ? "Subiendo…" : "Leyendo…"} />)}
          </section>
        )}
        {needs.length > 0 && (
          <section>
            <Label>Necesitan algo de ti</Label>
            {needs.map((it) => (
              <ResultRow key={it.key}
                mark={it.status === "failed" ? "err" : it.status === "pending_approval" ? "info" : "warn"}
                title={[it.numDoc ?? it.file.name, it.vendor].filter(Boolean).join(" · ")}
                sub={reasonOf(it, reasons[it.key])}
                action={it.docId ? <Link href={`/history/${it.docId}`} className={btn("secondary", "sm")}>{it.status === "review" ? "Revisar" : "Ver"}</Link> : undefined}
              />
            ))}
          </section>
        )}
        {done.length > 0 && (
          <section>
            <Label>Enviados al ERP sin intervención · {done.length}</Label>
            {done.slice(0, 6).map((it) => (
              <ResultRow key={it.key} mark="ok"
                title={[it.numDoc ?? it.file.name, it.vendor].filter(Boolean).join(" · ")}
                sub={[it.total != null ? it.total.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : null, it.erpId ? `ERP ${it.erpId}` : null].filter(Boolean).join(" · ") || "En el ERP"}
              />
            ))}
            {done.length > 6 && <p className="mt-1.5 text-[12.5px] text-muted-foreground">y {done.length - 6} más · <button type="button" onClick={onClose} className="text-link hover:underline">ver todos</button></p>}
          </section>
        )}
      </Drawer>
    );
  }

  const fileCount = items.length;
  const canRun = Boolean(sub) && fileCount > 0;
  const runLabel = bulk && fileCount > 1 ? `Procesar ${fileCount} ${cfdi ? "facturas" : "archivos"}` : "Procesar documento";

  return (
    <Drawer
      title="Subir documentos"
      description="Primero la subsidiaria: ella define cómo llegan sus facturas."
      onClose={onClose}
      footer={<>
        <button type="button" className={btn("secondary")} onClick={onClose}>Cancelar</button>
        <button type="button" className={btn("primary")} disabled={!canRun} onClick={run}>{runLabel}</button>
      </>}
    >
      {subsidiaries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay subsidiarias activas. Pide a DocuIA que configure al menos una.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-foreground/90">Subsidiaria</span>
            <div className="flex items-center gap-3 rounded-[10px] border border-border bg-white px-3.5 py-2.5">
              <span aria-hidden className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-lg text-[11px] font-bold", sub?.invoiceFormat === "cfdi" ? "bg-tone-info-bg text-tone-info" : "bg-tone-blue-bg text-tone-blue")}>{sub?.country ?? "—"}</span>
              <span className="min-w-0 flex-1">
                <b className="block font-semibold">{sub?.name}</b>
                {sub && <span className="text-[12.5px] text-muted-foreground">{formatHint(sub)}</span>}
              </span>
              {subsidiaries.length > 1 && (
                <select aria-label="Cambiar subsidiaria" value="" onChange={(e) => e.target.value && reset({ subId: e.target.value })}
                  className="min-h-[34px] rounded-lg border border-[#D6D2C8] bg-white px-2.5 text-[13px]">
                  <option value="">Cambiar</option>
                  {subsidiaries.filter((s) => s.id !== subId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
          </div>

          <div>
            <span id="doc-kind" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">Documento</span>
            <div role="group" aria-labelledby="doc-kind" className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-[9px] border border-[#D6D2C8] bg-white">
              {([["invoice", sub?.invoiceFormat === "cfdi" ? "Factura (CFDI)" : "Factura"], ["purchase_order", "Orden de compra"]] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => kind !== k && reset({ kind: k })}
                  className={cn("min-h-10 border-r border-[#D6D2C8] text-[13.5px] last:border-r-0", kind === k ? "bg-foreground font-semibold text-background" : "font-medium text-foreground/75 hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {bulkEnabled && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-[13.5px]">
              <span>
                <b className="block font-semibold">Subir varios</b>
                <span className="text-[12.5px] text-muted-foreground">Hasta {BULK_MAX} archivos en un lote.{cfdi ? " Cada XML se empareja con su PDF por nombre o UUID." : ""}</span>
              </span>
              <input type="checkbox" role="switch" checked={bulk} onChange={(e) => reset({ bulk: e.target.checked })} className="peer sr-only" />
              <span aria-hidden className="relative h-[22px] w-[38px] shrink-0 rounded-full bg-[#D6D2C8] transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/40" />
            </label>
          )}

          {!bulk && cfdi ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Slot label="XML del CFDI" hint="Obligatorio · de aquí salen los datos" accept={XML_ACCEPT} file={items[0]?.file}
                onFiles={(f) => addFiles(f)} pick="Elegir XML" />
              <Slot label="PDF de la factura" hint="Opcional · se adjunta en el ERP" accept=".pdf,application/pdf" file={items[0]?.pdf ?? unpaired[0]}
                onFiles={(f) => {
                  const pdf = Array.from(f ?? []).find(isPdf);
                  if (!pdf) return;
                  if (items[0]) patch(items[0].key, { pdf }); else setUnpaired([pdf]);
                }} pick="Elegir PDF" />
            </div>
          ) : !bulk ? (
            items[0]
              ? <FileList items={items} onRemove={() => setItems([])} />
              : <Drop accept={DOC_ACCEPT} title={kind === "purchase_order" ? "Arrastra la orden de compra aquí" : "Arrastra la factura aquí"} hint="PDF o imagen" onFiles={addFiles} />
          ) : (
            <>
              <Drop accept={cfdi ? `${XML_ACCEPT},.pdf,application/pdf` : DOC_ACCEPT} multiple disabled={fileCount >= BULK_MAX}
                title={cfdi ? "Arrastra los XML y sus PDF aquí" : kind === "purchase_order" ? "Arrastra las órdenes aquí" : "Arrastra las facturas aquí"}
                hint={cfdi ? "XML y PDF juntos" : "PDF o imagen"} onFiles={addFiles} />
              {fileCount > 0 && <FileList items={items} onRemove={(key) => setItems(items.filter((i) => i.key !== key))} showPdf={cfdi} />}
              {cfdi && unpaired.length > 0 && (
                <p className="text-[12.5px] text-tone-warn">{unpaired.length} PDF sin su XML ({unpaired.slice(0, 2).map((p) => p.name).join(", ")}{unpaired.length > 2 ? "…" : ""}). Agrega el XML o se omitirán.</p>
              )}
            </>
          )}
          {notice && <p className="text-[12.5px] text-tone-warn">{notice}</p>}
        </>
      )}
    </Drawer>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.05em] text-foreground/75">{children}</span>;
}

const MARK = {
  ok:   { cls: "bg-tone-ok-bg text-tone-ok",     sym: "✓", sr: "En el ERP" },
  warn: { cls: "bg-tone-warn-bg text-tone-warn", sym: "!", sr: "Necesita revisión" },
  err:  { cls: "bg-tone-err-bg text-tone-err",   sym: "✕", sr: "Con error" },
  info: { cls: "bg-tone-blue-bg text-tone-blue", sym: "●", sr: "Espera aprobación" },
  run:  { cls: "bg-tone-info-bg text-tone-info", sym: "",  sr: "En proceso" },
} as const;

function ResultRow({ mark, title, sub, action }: { mark: keyof typeof MARK; title: string; sub: string; action?: React.ReactNode }) {
  const m = MARK[mark];
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft py-2.5 text-[13.5px] last:border-0">
      <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-bold", m.cls)}>
        {mark === "run" ? <Loader2 className="size-3 animate-spin" /> : <span aria-hidden>{m.sym}</span>}
        <span className="sr-only">{m.sr}</span>
      </span>
      <span className="min-w-0">
        <b className="block truncate font-semibold">{title}</b>
        <small className="block truncate text-[12.5px] text-muted-foreground">{sub}</small>
      </span>
      {action ?? <span />}
    </div>
  );
}

function Drop({ accept, multiple, disabled, title, hint, onFiles }: {
  accept: string; multiple?: boolean; disabled?: boolean; title: string; hint: string; onFiles: (f: FileList | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(e.dataTransfer.files); }}
      className={cn("flex flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed px-5.5 py-6.5 text-center transition-colors",
        over ? "border-primary bg-tone-info-bg" : "border-[#C9C5BC] bg-background", disabled && "opacity-50")}
    >
      <Upload aria-hidden className="size-5 text-link" />
      <b className="text-sm font-semibold">{title}</b>
      <span className="text-[12.5px] text-muted-foreground">
        {hint} · <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="text-link hover:underline">elegir desde tu equipo</button>
      </span>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" tabIndex={-1}
        onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function Slot({ label, hint, accept, file, onFiles, pick }: {
  label: string; hint: string; accept: string; file?: File; onFiles: (f: FileList | null) => void; pick: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
      className={cn("flex min-h-[120px] flex-col items-start gap-1.5 rounded-xl px-3.5 py-4.5",
        file ? "border border-[#CFE7E3] bg-white" : "border-[1.5px] border-dashed border-[#C9C5BC] bg-background")}
    >
      <b className="text-sm font-semibold">{label}</b>
      {file && (
        <span className="flex items-center gap-2 text-[13px]">
          <FileBadge file={file} />
          <span className="min-w-0 break-all">{file.name}</span>
        </span>
      )}
      <span className="text-[12.5px] text-muted-foreground">{hint}</span>
      <button type="button" onClick={() => input.current?.click()} className="text-[13px] text-link hover:underline">{file ? "Cambiar" : pick}</button>
      <input ref={input} type="file" accept={accept} multiple className="sr-only" tabIndex={-1}
        onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function FileBadge({ file }: { file: File }) {
  const e = ext(file);
  const tone = e === "XML" ? "bg-tone-blue-bg text-tone-blue" : e === "PDF" ? "bg-tone-err-bg text-tone-err" : "bg-tone-mute-bg text-tone-mute";
  return <i aria-hidden className={cn("flex h-8 w-[26px] shrink-0 items-end justify-center rounded pb-[3px] text-[8.5px] font-bold not-italic", tone)}>{e}</i>;
}

function FileList({ items, onRemove, showPdf }: { items: Item[]; onRemove: (key: string) => void; showPdf?: boolean }) {
  return (
    <div>
      <Label>{items.length === 1 ? "1 archivo" : `${items.length} archivos`}</Label>
      {items.map((it) => (
        <div key={it.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line-soft py-2 text-[13px] last:border-0">
          <FileBadge file={it.file} />
          <span className="min-w-0">
            <span className="block truncate">{it.file.name}</span>
            {showPdf && <small className={cn("block truncate text-xs", it.pdf ? "text-muted-foreground" : "text-tone-warn")}>{it.pdf ? `con ${it.pdf.name}` : "sin PDF · se procesa solo con el XML"}</small>}
          </span>
          <button type="button" onClick={() => onRemove(it.key)} className={btn("text", "sm")}>Quitar</button>
        </div>
      ))}
    </div>
  );
}
