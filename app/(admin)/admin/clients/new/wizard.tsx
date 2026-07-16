"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, CircleDot, Circle, Loader2,
  ChevronRight, Building2, KeyRound, Code2,
  Server, Zap, Globe, UserPlus, AlertTriangle,
  Eye, EyeOff, Download, ExternalLink,
  FileText, Receipt, ScrollText, Package,
} from "lucide-react";
import { PRODUCTS } from "@/lib/products/registry";

const PRODUCT_ICONS: Record<string, React.ElementType> = {
  FileText, Receipt, ScrollText,
};
const NS_STEP_IDS = new Set(["sandbox", "scripts", "subs", "sync", "production"]);

// ── Types ────────────────────────────────────────────────────────────

interface TBACreds {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

interface ScriptIds {
  catalogScriptId: string;
  catalogDeployId: string;
  processScriptId: string;
  processDeployId: string;
}

interface NSSubsidiary {
  internal_id: string;
  name: string;
  country: string;
  currency: string;
}

// ── Step configuration ───────────────────────────────────────────────

const STEPS = [
  { id: "org",        label: "Organización",  icon: Building2 },
  { id: "sandbox",    label: "Sandbox NS",    icon: KeyRound  },
  { id: "scripts",    label: "Scripts",       icon: Code2     },
  { id: "subs",       label: "Subsidiarias",  icon: Server    },
  { id: "sync",       label: "Sync",          icon: Zap       },
  { id: "production", label: "Producción",    icon: Globe     },
  { id: "users",      label: "Usuarios",      icon: UserPlus  },
];

// ── Helpers ──────────────────────────────────────────────────────────

const EMPTY_CREDS: TBACreds = {
  accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "",
};

const EMPTY_SCRIPTS: ScriptIds = {
  catalogScriptId: "", catalogDeployId: "", processScriptId: "", processDeployId: "",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function apiFetch(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Sub-components ───────────────────────────────────────────────────

function CredFields({
  value,
  onChange,
  disabled,
}: {
  value: TBACreds;
  onChange: (v: TBACreds) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  const set = (k: keyof TBACreds) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <div className="space-y-3">
      <Field label="Account ID" placeholder="9051643 or 9051643_SB1">
        <Input value={value.accountId} onChange={set("accountId")} disabled={disabled} />
      </Field>
      <Field label="Consumer Key">
        <Input value={value.consumerKey} onChange={set("consumerKey")} disabled={disabled} />
      </Field>
      <Field label="Consumer Secret">
        <SecretInput value={value.consumerSecret} onChange={set("consumerSecret")} disabled={disabled} visible={visible} />
      </Field>
      <Field label="Token ID">
        <Input value={value.tokenId} onChange={set("tokenId")} disabled={disabled} />
      </Field>
      <Field label="Token Secret">
        <SecretInput value={value.tokenSecret} onChange={set("tokenSecret")} disabled={disabled} visible={visible} />
      </Field>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        {visible ? "Ocultar secrets" : "Mostrar secrets"}
      </button>
    </div>
  );
}

function SecretInput({
  value, onChange, disabled, visible,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  visible: boolean;
}) {
  return (
    <Input
      type={visible ? "text" : "password"}
      value={value}
      onChange={onChange}
      disabled={disabled}
      autoComplete="off"
    />
  );
}

function Field({ label, children, placeholder }: { label: string; children: React.ReactNode; placeholder?: string }) {
  void placeholder;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StatusBadge({ ok, message }: { ok: boolean; message: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg text-xs border",
      ok
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-destructive/10 border-destructive/20 text-destructive",
    )}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
      {message}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────

export function ClientWizard() {
  const router = useRouter();
  const [phase, setPhase] = useState<"select" | "config">("select");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set(["ap_automation"]));
  const [contractMaxFlows, setContractMaxFlows] = useState(3);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Does any selected product need an external integration (NetSuite)?
  const needsNS = [...selectedProducts].some(
    (k) => PRODUCTS.find((p) => p.key === k)?.requiresIntegration,
  );
  const USERS_STEP = STEPS.findIndex((s) => s.id === "users");
  const visibleSteps = STEPS
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => needsNS || !NS_STEP_IDS.has(s.id));

  const toggleProduct = (key: string) =>
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Step 0 — org
  const [orgName, setOrgName]         = useState("");
  const [orgSlug, setOrgSlug]         = useState("");
  const [orgTimezone, setOrgTimezone] = useState("America/Mexico_City");
  const [orgEmail, setOrgEmail]       = useState("");
  const [orgId, setOrgId]             = useState<string | null>(null);

  // Step 1 — sandbox credentials
  const [sbCreds, setSbCreds] = useState<TBACreds>(EMPTY_CREDS);
  const [sbTested, setSbTested] = useState(false);
  const [sbSaved, setSbSaved]   = useState(false);

  // Step 2 — scripts
  const [scripts, setScripts]     = useState<ScriptIds>(EMPTY_SCRIPTS);
  const [scriptProbed, setScriptProbed] = useState(false);
  const [scriptVersion, setScriptVersion] = useState<string | null>(null);

  // Step 3 — subsidiaries
  const [nsSubsidiaries, setNsSubsidiaries]         = useState<NSSubsidiary[]>([]);
  const [selectedSubs, setSelectedSubs]             = useState<Set<string>>(new Set());
  const [nsIdToDbId, setNsIdToDbId]                 = useState<Record<string, string>>({}); // nsSubsidiaryId → DB id
  const [subsidsFetched, setSubsidsFetched]         = useState(false);
  const [subsidsSaved, setSubsidsSaved]             = useState(false);

  // Step 4 — sync
  const [syncStatus, setSyncStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncSummary, setSyncSummary] = useState<Record<string, number> | null>(null);

  // Step 5 — production credentials
  const [prodCreds, setProdCreds]   = useState<TBACreds>(EMPTY_CREDS);
  const [prodTested, setProdTested] = useState(false);
  const [prodSaved, setProdSaved]   = useState(false);
  const [skipProd, setSkipProd]     = useState(false);

  // Step 6 — first user
  const [userEmail, setUserEmail]   = useState("");
  const [userName, setUserName]     = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userCreated, setUserCreated]   = useState(false);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Step handlers ─────────────────────────────────────────────────

  const handleCreateOrg = () => run(async () => {
    if (!orgName || !orgSlug) throw new Error("Nombre y slug son requeridos");
    if (selectedProducts.size === 0) throw new Error("Selecciona al menos un producto");
    const data = await apiFetch("/api/admin/clients", {
      name: orgName, slug: orgSlug, timezone: orgTimezone, billingEmail: orgEmail || undefined,
      products: [...selectedProducts],
      contractMaxFlows: selectedProducts.has("contract_intelligence") ? contractMaxFlows : undefined,
    });
    if (!data.ok) throw new Error(data.error ?? "Error al crear organización");
    setOrgId(data.organizationId);
    // Skip the NetSuite steps entirely when no selected product needs integration.
    setStep(needsNS ? 1 : USERS_STEP);
  });

  const handleTestSandbox = () => run(async () => {
    if (!sbCreds.accountId || !sbCreds.consumerKey) throw new Error("Completa las credenciales TBA");
    const data = await apiFetch("/api/admin/ns/test-connection", sbCreds);
    if (!data.ok) throw new Error(data.error ?? "Conexión fallida");
    setSbTested(true);
  });

  const handleSaveSandbox = () => run(async () => {
    if (!sbTested) throw new Error("Prueba la conexión primero");
    const data = await apiFetch(`/api/admin/clients/${orgId}/connection`, {
      environment: "sandbox",
      ...sbCreds,
      connectionStatus: "connected",
    });
    if (!data.ok) throw new Error(data.error ?? "Error al guardar");
    setSbSaved(true);
    setStep(2);
  });

  const handleProbeScripts = () => run(async () => {
    if (!scripts.catalogScriptId || !scripts.catalogDeployId) throw new Error("Ingresa los IDs del script de catálogo");
    const data = await apiFetch("/api/admin/ns/probe-scripts", {
      ...sbCreds,
      catalogScriptId: scripts.catalogScriptId,
      catalogDeployId: scripts.catalogDeployId,
    });
    if (!data.ok) throw new Error(data.error ?? "Script no responde");
    setScriptProbed(true);
    setScriptVersion(data.version ?? null);
  });

  const handleSaveScripts = () => run(async () => {
    if (!scriptProbed) throw new Error("Verifica los scripts primero");
    const data = await apiFetch(`/api/admin/clients/${orgId}/connection`, {
      environment: "sandbox",
      ...sbCreds,
      ...scripts,
      scriptsInstalled: true,
      installMethod: "manual",
      connectionStatus: "connected",
    });
    if (!data.ok) throw new Error(data.error ?? "Error al guardar scripts");
    setStep(3);
  });

  const handleSkipScripts = () => run(async () => {
    // If IDs were entered, save them unverified; otherwise just advance
    if (scripts.catalogScriptId && scripts.catalogDeployId) {
      const data = await apiFetch(`/api/admin/clients/${orgId}/connection`, {
        environment: "sandbox",
        ...sbCreds,
        ...scripts,
        scriptsInstalled: false,
        connectionStatus: "connected",
      });
      if (!data.ok) throw new Error(data.error ?? "Error al guardar");
    }
    setStep(3);
  });

  const handleFetchSubsidiaries = () => run(async () => {
    if (!scripts.catalogScriptId) throw new Error("Scripts no configurados");
    const data = await apiFetch("/api/admin/ns/subsidiaries", {
      ...sbCreds,
      catalogScriptId: scripts.catalogScriptId,
      catalogDeployId: scripts.catalogDeployId,
    });
    if (!data.ok) throw new Error(data.error ?? "No se pudieron obtener las subsidiarias");
    setNsSubsidiaries(data.subsidiaries ?? []);
    setSelectedSubs(new Set((data.subsidiaries as NSSubsidiary[]).map((s) => s.internal_id)));
    setSubsidsFetched(true);
  });

  const handleSaveSubsidiaries = () => run(async () => {
    if (!selectedSubs.size) throw new Error("Selecciona al menos una subsidiaria");
    const toSave = nsSubsidiaries
      .filter((s) => selectedSubs.has(s.internal_id))
      .map((s) => ({ nsSubsidiaryId: s.internal_id, name: s.name, currency: s.currency }));
    const data = await apiFetch(`/api/admin/clients/${orgId}/subsidiaries`, { subsidiaries: toSave });
    if (!data.ok) throw new Error(data.error ?? "Error al guardar subsidiarias");

    // Build nsSubsidiaryId → dbId map for use in sync step
    const subsRes = await fetch(`/api/admin/clients/${orgId}/subsidiaries`);
    const subsData = await subsRes.json();
    const map: Record<string, string> = {};
    for (const s of (subsData.subsidiaries ?? []) as { id: string; nsSubsidiaryId: string }[]) {
      map[s.nsSubsidiaryId] = s.id;
    }
    setNsIdToDbId(map);

    setSubsidsSaved(true);
    setStep(4);
  });

  const handleSync = async (subsidiaryDbId: string) => {
    setSyncStatus("running");
    setSyncSummary(null);
    try {
      const data = await apiFetch(`/api/admin/clients/${orgId}/sync`, {
        subsidiaryId: subsidiaryDbId,
        types: ["items", "vendors", "locations"],
      });
      if (!data.ok) throw new Error(data.error ?? "Sync fallido");
      setSyncSummary(data.summary ?? {});
      setSyncStatus("done");
    } catch (e) {
      setSyncStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTestProd = () => run(async () => {
    if (!prodCreds.accountId) throw new Error("Completa las credenciales TBA de producción");
    const data = await apiFetch("/api/admin/ns/test-connection", prodCreds);
    if (!data.ok) throw new Error(data.error ?? "Conexión fallida");
    setProdTested(true);
  });

  const handleSaveProd = () => run(async () => {
    if (!prodTested) throw new Error("Prueba la conexión primero");
    const data = await apiFetch(`/api/admin/clients/${orgId}/connection`, {
      environment: "production",
      ...prodCreds,
      connectionStatus: "connected",
    });
    if (!data.ok) throw new Error(data.error ?? "Error al guardar");
    setProdSaved(true);
    setStep(6);
  });

  const handleCreateUser = () => run(async () => {
    if (!userEmail || !userPassword) throw new Error("Email y contraseña son requeridos");
    const data = await apiFetch(`/api/admin/clients/${orgId}/users`, {
      email: userEmail, fullName: userName || undefined, role: "admin", password: userPassword,
    });
    if (!data.ok) throw new Error(data.error ?? "Error al crear usuario");
    setUserCreated(true);
  });

  const handleFinish = () => {
    router.push(`/admin/clients/${orgId}`);
  };

  // ── Render ────────────────────────────────────────────────────────

  // ── Phase: product selection (first step) ─────────────────────────
  if (phase === "select") {
    return (
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b border-border px-6 flex items-center gap-4 shrink-0">
          <button
            onClick={() => router.push("/admin/clients")}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            ← Clientes
          </button>
          <div className="w-px h-4 bg-border" />
          <h1 className="text-sm font-semibold text-foreground">Nueva organización · Productos</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">¿Qué productos va a usar este cliente?</h2>
              <p className="text-xs text-muted-foreground mt-1">Puedes seleccionar uno o varios. Luego configurarás cada uno.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {PRODUCTS.map((p) => {
                const Icon = PRODUCT_ICONS[p.icon] ?? Package;
                const active = selectedProducts.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggleProduct(p.key)}
                    className={cn(
                      "text-left p-4 rounded-xl border transition-all",
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-border/80",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>
                        <Icon className="w-4 h-4" />
                      </div>
                      {active
                        ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    </div>
                    <p className="text-sm font-medium text-foreground mt-3">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                    {p.requiresIntegration && (
                      <span className="inline-block mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        Requiere NetSuite
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedProducts.has("contract_intelligence") && (
              <div className="rounded-xl border border-border bg-card p-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Máximo de flujos (Contract Intelligence)</span>
                  <p className="text-[11px] text-muted-foreground">Cuántos flujos distintos podrá crear este cliente en el editor de flujos.</p>
                  <input type="number" min={1} max={50} value={contractMaxFlows}
                    onChange={(e) => setContractMaxFlows(Math.max(1, Number(e.target.value) || 1))}
                    className="w-28 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm mt-1" />
                </label>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button onClick={() => setPhase("config")} disabled={selectedProducts.size === 0}>
                Continuar <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-4 shrink-0">
        <button
          onClick={() => setPhase("select")}
          className="text-muted-foreground hover:text-foreground transition-colors text-xs"
        >
          ← Productos
        </button>
        <div className="w-px h-4 bg-border" />
        <h1 className="text-sm font-semibold text-foreground">Nueva organización</h1>
      </div>

      {/* Step indicators */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-1 overflow-x-auto shrink-0">
        {/* Productos: ya elegidos en la fase previa */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <Package className="w-3 h-3" />
            Productos
          </div>
          <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
        </div>
        {visibleSteps.map(({ id, label, icon: Icon, index }, vi) => {
          const state = index < step ? "done" : index === step ? "active" : "pending";
          return (
            <div key={id} className="flex items-center gap-1 shrink-0">
              <div className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium",
                state === "done"    && "text-emerald-400",
                state === "active"  && "bg-primary/15 text-primary",
                state === "pending" && "text-muted-foreground/50",
              )}>
                {state === "done"    ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                 state === "active"  ? <CircleDot className="w-3.5 h-3.5" /> :
                                       <Circle className="w-3.5 h-3.5" />}
                <Icon className="w-3 h-3" />
                {label}
              </div>
              {vi < visibleSteps.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto space-y-4">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── Step 0: Organization ─────────────────────────────────── */}
          {step === 0 && (
            <SectionCard title="Crear organización">
              <Field label="Nombre de la empresa">
                <Input
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    setOrgSlug(slugify(e.target.value));
                  }}
                  placeholder="Acme Corp"
                />
              </Field>
              <Field label="Slug (identificador único)">
                <Input
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(slugify(e.target.value))}
                  placeholder="acme-corp"
                />
              </Field>
              <Field label="Zona horaria">
                <Input
                  value={orgTimezone}
                  onChange={(e) => setOrgTimezone(e.target.value)}
                  placeholder="America/Mexico_City"
                />
              </Field>
              <Field label="Email de facturación (opcional)">
                <Input
                  type="email"
                  value={orgEmail}
                  onChange={(e) => setOrgEmail(e.target.value)}
                  placeholder="billing@acme.com"
                />
              </Field>
              <Button onClick={handleCreateOrg} disabled={loading || !orgName}>
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear organización
              </Button>
            </SectionCard>
          )}

          {/* ── Step 1: Sandbox credentials ──────────────────────────── */}
          {step === 1 && (
            <>
              <SectionCard title="Credenciales NetSuite — Sandbox">
                <p className="text-xs text-muted-foreground">
                  El Account ID para sandbox generalmente termina en <code className="bg-secondary px-1 rounded">_SB1</code> (ej. <code className="bg-secondary px-1 rounded">9051643_SB1</code>).
                </p>
                <CredFields value={sbCreds} onChange={setSbCreds} disabled={sbSaved} />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleTestSandbox}
                    disabled={loading || sbSaved}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Probar conexión
                  </Button>
                  <Button
                    onClick={handleSaveSandbox}
                    disabled={loading || !sbTested || sbSaved}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Guardar y continuar
                  </Button>
                </div>
                {sbTested && !sbSaved && <StatusBadge ok={true} message="Conexión exitosa — credenciales verificadas" />}
                {sbSaved && <StatusBadge ok={true} message="Credenciales guardadas" />}
              </SectionCard>
            </>
          )}

          {/* ── Step 2: Scripts ─────────────────────────────────────── */}
          {step === 2 && (
            <>
              <SectionCard title="Instalación de SuiteScripts">
                <p className="text-xs text-muted-foreground">
                  Instala los dos scripts en la cuenta NetSuite del cliente. Ambos deben cargarse como Restlets en SuiteCloud.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2.5 bg-secondary/50 rounded-lg border border-border">
                    <div>
                      <p className="text-xs font-medium text-foreground">docuia-catalog-v1.js</p>
                      <p className="text-[11px] text-muted-foreground">Subsidiarias, catálogo de ítems, proveedores y ubicaciones</p>
                    </div>
                    <a
                      href="/scripts/netsuite/docuia-catalog-v1.js"
                      download
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Descargar
                    </a>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5 bg-secondary/50 rounded-lg border border-border">
                    <div>
                      <p className="text-xs font-medium text-foreground">docuia-process-v1.js</p>
                      <p className="text-[11px] text-muted-foreground">Creación de Vendor Bills y Purchase Orders</p>
                    </div>
                    <a
                      href="/scripts/netsuite/docuia-process-v1.js"
                      download
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Descargar
                    </a>
                  </div>
                </div>

                <a
                  href="https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4387799f7b.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Cómo subir un RESTlet en NetSuite
                </a>
              </SectionCard>

              <SectionCard title="IDs de los scripts instalados">
                <p className="text-xs text-muted-foreground">
                  Cada script tiene dos IDs en NetSuite: el <strong className="text-foreground">Script ID</strong> (del record del script) y el <strong className="text-foreground">Deploy ID</strong> (del deployment). Los encuentras en <em>Customization → Scripting → Scripts</em>.
                </p>

                {/* Script 1 — Catálogo (requerido) */}
                <div className="space-y-2.5 p-3 rounded-lg border border-border bg-secondary/30">
                  <p className="text-xs font-medium text-foreground">Script 1 — Catálogo <span className="text-primary">(requerido)</span></p>
                  <p className="text-[11px] text-muted-foreground">docuia-catalog-v1.js — subsidiarias, ítems, proveedores, ubicaciones</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Script ID">
                      <Input
                        value={scripts.catalogScriptId}
                        onChange={(e) => setScripts(s => ({ ...s, catalogScriptId: e.target.value }))}
                        placeholder="customscript_docuia_catalog"
                      />
                    </Field>
                    <Field label="Deploy ID">
                      <Input
                        value={scripts.catalogDeployId}
                        onChange={(e) => setScripts(s => ({ ...s, catalogDeployId: e.target.value }))}
                        placeholder="customdeploy_docuia_catalog"
                      />
                    </Field>
                  </div>
                </div>

                {/* Script 2 — Proceso (opcional) */}
                <div className="space-y-2.5 p-3 rounded-lg border border-border bg-secondary/30">
                  <p className="text-xs font-medium text-foreground">Script 2 — Proceso <span className="text-muted-foreground">(opcional, se puede agregar después)</span></p>
                  <p className="text-[11px] text-muted-foreground">docuia-process-v1.js — crea Vendor Bills y Purchase Orders</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Script ID">
                      <Input
                        value={scripts.processScriptId}
                        onChange={(e) => setScripts(s => ({ ...s, processScriptId: e.target.value }))}
                        placeholder="customscript_docuia_process"
                      />
                    </Field>
                    <Field label="Deploy ID">
                      <Input
                        value={scripts.processDeployId}
                        onChange={(e) => setScripts(s => ({ ...s, processDeployId: e.target.value }))}
                        placeholder="customdeploy_docuia_process"
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleProbeScripts}
                    disabled={loading}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Verificar script de catálogo
                  </Button>
                  <Button
                    onClick={handleSaveScripts}
                    disabled={loading || !scriptProbed}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Guardar y continuar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={handleSkipScripts}
                    className="text-xs text-muted-foreground ml-auto"
                  >
                    Omitir verificación (configurar después)
                  </Button>
                </div>

                {scriptProbed && (
                  <StatusBadge ok={true} message={`Catálogo responde correctamente${scriptVersion ? ` (${scriptVersion})` : ""}`} />
                )}
              </SectionCard>
            </>
          )}

          {/* ── Step 3: Subsidiaries ────────────────────────────────── */}
          {step === 3 && (
            <SectionCard title="Subsidiarias NetSuite">
              <p className="text-xs text-muted-foreground">
                Extrae las subsidiarias disponibles en la cuenta NS y selecciona las que DocuIA debe gestionar.
              </p>

              {!subsidsFetched ? (
                <Button onClick={handleFetchSubsidiaries} disabled={loading} variant="outline">
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Obtener subsidiarias desde NetSuite
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {nsSubsidiaries.map((sub) => (
                      <label
                        key={sub.internal_id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                          selectedSubs.has(sub.internal_id)
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-card/50 hover:bg-card",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSubs.has(sub.internal_id)}
                          onChange={(e) => {
                            const next = new Set(selectedSubs);
                            e.target.checked ? next.add(sub.internal_id) : next.delete(sub.internal_id);
                            setSelectedSubs(next);
                          }}
                          className="w-3.5 h-3.5 accent-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{sub.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            ID: {sub.internal_id} · {sub.currency} · {sub.country || "—"}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {selectedSubs.size} de {nsSubsidiaries.length} seleccionadas
                    </span>
                    <div className="flex-1" />
                    <Button
                      onClick={handleSaveSubsidiaries}
                      disabled={loading || !selectedSubs.size}
                      size="sm"
                    >
                      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Guardar y continuar
                    </Button>
                  </div>

                  {subsidsSaved && <StatusBadge ok={true} message="Subsidiarias guardadas" />}
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Step 4: Catalog sync ────────────────────────────────── */}
          {step === 4 && (
            <SectionCard title="Sincronización inicial del catálogo">
              <p className="text-xs text-muted-foreground">
                Carga ítems, proveedores y ubicaciones desde NetSuite a DocuIA.
                Necesario para que el motor de IA pueda mapear los documentos.
              </p>

              {Object.keys(nsIdToDbId).length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Selecciona una subsidiaria para sincronizar ahora. Puedes sincronizar las demás después desde el panel del cliente.
                  </p>

                  <div className="space-y-1.5">
                    {nsSubsidiaries
                      .filter((s) => selectedSubs.has(s.internal_id))
                      .map((s) => {
                        const dbId = nsIdToDbId[s.internal_id];
                        return (
                          <div key={s.internal_id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-card/50">
                            <div>
                              <p className="text-xs font-medium text-foreground">{s.name}</p>
                              <p className="text-[11px] text-muted-foreground">{s.currency} · ID: {s.internal_id}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={syncStatus === "running" || !dbId}
                              onClick={() => dbId && handleSync(dbId)}
                            >
                              {syncStatus === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Sincronizar
                            </Button>
                          </div>
                        );
                      })}
                  </div>

                  {syncStatus === "done" && syncSummary && (
                    <StatusBadge ok={true} message={
                      `Sync completo — ítems: ${syncSummary.items ?? 0}, proveedores: ${syncSummary.vendors ?? 0}, ubicaciones: ${syncSummary.locations ?? 0}`
                    } />
                  )}
                </div>
              ) : (
                <p className="text-xs text-amber-400">No hay subsidiarias guardadas. Regresa al paso anterior.</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setStep(5)}>
                  {syncStatus === "done" ? "Continuar" : "Omitir por ahora"}
                </Button>
              </div>
            </SectionCard>
          )}

          {/* ── Step 5: Production ──────────────────────────────────── */}
          {step === 5 && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-foreground">Entorno de producción</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSkipProd(true); setStep(6); }}
                  className="text-xs text-muted-foreground"
                >
                  Omitir (solo sandbox por ahora)
                </Button>
              </div>

              <SectionCard title="Credenciales NetSuite — Producción">
                <p className="text-xs text-muted-foreground">
                  El Account ID de producción no tiene sufijo (ej. <code className="bg-secondary px-1 rounded">9051643</code>).
                  Las credenciales TBA son independientes de las de sandbox.
                </p>
                <CredFields value={prodCreds} onChange={setProdCreds} disabled={prodSaved} />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleTestProd}
                    disabled={loading || prodSaved}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Probar conexión
                  </Button>
                  <Button
                    onClick={handleSaveProd}
                    disabled={loading || !prodTested || prodSaved}
                    size="sm"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Guardar producción
                  </Button>
                </div>
                {prodTested && !prodSaved && <StatusBadge ok={true} message="Conexión de producción verificada" />}
                {prodSaved && <StatusBadge ok={true} message="Producción guardada" />}
              </SectionCard>
            </>
          )}

          {/* ── Step 6: First user ──────────────────────────────────── */}
          {step === 6 && !userCreated && (
            <SectionCard title="Crear primer usuario administrador">
              <p className="text-xs text-muted-foreground">
                Este usuario podrá acceder al portal de la organización en DocuIA.
              </p>
              <Field label="Email">
                <Input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="admin@acme.com"
                />
              </Field>
              <Field label="Nombre completo (opcional)">
                <Input
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Ana García"
                />
              </Field>
              <Field label="Contraseña inicial">
                <Input
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Button onClick={handleCreateUser} disabled={loading || !userEmail || !userPassword}>
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear usuario
              </Button>
            </SectionCard>
          )}

          {/* ── Completion ──────────────────────────────────────────── */}
          {step === 6 && userCreated && (
            <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">¡Organización configurada!</h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  <span className="font-medium text-foreground">{orgName}</span> está lista.
                  {skipProd && " El entorno de producción puede configurarse después desde el perfil del cliente."}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => router.push("/admin/clients")} size="sm">
                  Ver todos los clientes
                </Button>
                <Button onClick={handleFinish} size="sm">
                  Ir al perfil del cliente
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
