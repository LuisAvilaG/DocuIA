"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, Users, Server, Shield, Sparkles,
  Pencil, Check, X, UserPlus, Copy, CheckCircle2, Loader2,
  Webhook, Plus, Trash2, ToggleLeft, ToggleRight, ExternalLink,
  Key, ScrollText, FlaskConical, Receipt, AlertCircle, RefreshCw, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/form-select";
import { useFeature } from "@/components/providers/feature-provider";

type OrgData = {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  billingEmail: string | null;
  autoProcessThreshold: number;
  createdAt: string;
};

type UserData = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type SubData = {
  id: string;
  name: string;
  nsSubsidiaryId: string;
  currency: string;
  locale: string;
  isActive: boolean;
  createdAt: string;
};

type WebhookData = {
  id:              string;
  url:             string;
  events:          string[];
  isActive:        boolean;
  lastTriggeredAt: string | null;
  lastStatusCode:  number | null;
  createdAt:       string;
};

type ExpenseCategoryRow = {
  id:                  number;
  name:                string;
  netsuiteAccountName: string | null;
  dailyCap:            string | null;
  monthlyCap:          string | null;
};

type ExpenseData = {
  categories:      ExpenseCategoryRow[];
  departmentCount: number;
  classCount:      number;
  submitterCount:  number;
} | null;

interface Props {
  org: OrgData;
  users: UserData[];
  subsidiaries: SubData[];
  plan: string;
  currentUserRole: string;
  webhooks: WebhookData[];
  dryRun: boolean;
  dryRunGranted: boolean;
  expenseData: ExpenseData;
}

type Tab = "org" | "subsidiaries" | "team" | "gastos" | "webhooks" | "api_keys" | "audit";

const ALL_TABS: { id: Tab; label: string; icon: React.ElementType; feature?: string }[] = [
  { id: "org",          label: "Organización", icon: Building2 },
  { id: "subsidiaries", label: "Subsidiarias",  icon: Server },
  { id: "team",         label: "Equipo",        icon: Users },
  { id: "gastos",       label: "Gastos",        icon: Receipt,     feature: "expense_management" },
  { id: "webhooks",     label: "Webhooks",      icon: Webhook,     feature: "webhook_system" },
  { id: "api_keys",     label: "API Keys",      icon: Key,         feature: "api_keys" },
  { id: "audit",        label: "Auditoría",     icon: ScrollText,  feature: "tenant_audit_log" },
];

const ROLE_BADGE: Record<string, string> = {
  admin:    "bg-primary/10 text-primary",
  operator: "bg-secondary text-muted-foreground",
  viewer:   "bg-secondary text-muted-foreground",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador", operator: "Operador", viewer: "Visor",
  expense_submitter: "Colaborador Gastos",
};

const STATUS_BADGE: Record<string, string> = {
  trial:     "bg-warning/10 text-warning",
  active:    "bg-success/10 text-success",
  suspended: "bg-destructive/10 text-destructive",
  churned:   "bg-secondary text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial", active: "Activo", suspended: "Suspendido", churned: "Cancelado",
};

const TIMEZONES = [
  "America/Mexico_City", "America/Monterrey", "America/Cancun",
  "America/Bogota", "America/Lima", "America/Santiago",
  "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "UTC",
];

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function relativeDate(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

type ApiKeyRow = {
  id:          string;
  name:        string;
  keyPrefix:   string;
  isActive:    boolean;
  lastUsedAt:  string | null;
  expiresAt:   string | null;
  createdAt:   string;
};

type AuditEntry = {
  id:           string;
  userId:       string | null;
  userEmail:    string | null;
  action:       string;
  resourceType: string | null;
  resourceId:   string | null;
  ipAddress:    string | null;
  createdAt:    string;
};

export function SettingsClient({ org, users: initialUsers, subsidiaries, plan, currentUserRole, webhooks: initialWebhooks, dryRun: initialDryRun, dryRunGranted: initialDryRunGranted, expenseData: initialExpenseData }: Props) {
  const router = useRouter();
  const webhookSystem   = useFeature("webhook_system");
  const apiKeysFeat     = useFeature("api_keys");
  const auditFeat       = useFeature("tenant_audit_log");
  const expenseFeat     = useFeature("expense_management");

  const tabs = useMemo(
    () => ALL_TABS.filter(t => {
      if (!t.feature) return true;
      if (t.feature === "webhook_system")     return webhookSystem;
      if (t.feature === "api_keys")           return apiKeysFeat;
      if (t.feature === "tenant_audit_log")   return auditFeat;
      if (t.feature === "expense_management") return expenseFeat;
      return false;
    }),
    [webhookSystem, apiKeysFeat, auditFeat, expenseFeat]
  );

  const [tab,     setTab]     = useState<Tab>("org");
  const [users,   setUsers]   = useState(initialUsers);
  const isAdmin = currentUserRole === "admin";

  // ── Dry run state ────────────────────────────────────────────────
  const [dryRunGranted]                   = useState(initialDryRunGranted);
  const [dryRun,        setDryRun]        = useState(initialDryRun);
  const [dryRunSaving,  setDryRunSaving]  = useState(false);
  const [dryRunError,   setDryRunError]   = useState("");
  const [dryRunSaved,   setDryRunSaved]   = useState(false);

  // Sync from server after router.refresh() — only when not in the middle of saving
  useEffect(() => {
    if (!dryRunSaving) setDryRun(initialDryRun);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDryRun]);

  async function handleToggleDryRun() {
    const next = !dryRun;
    setDryRun(next);
    setDryRunSaving(true);
    setDryRunError("");
    setDryRunSaved(false);
    try {
      const res  = await fetch("/api/v1/features/dry-run", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDryRun(!next);
        setDryRunError(data.error ?? "Error al guardar");
      } else {
        // Use the server-confirmed effective value (adminGranted && tenantEnabled)
        setDryRun(data.isEnabled);
        setDryRunSaved(true);
        setTimeout(() => setDryRunSaved(false), 3000);
        router.refresh();
      }
    } catch {
      setDryRun(!next);
      setDryRunError("No se pudo conectar al servidor");
    } finally {
      setDryRunSaving(false);
    }
  }

  // ── Org edit state ──────────────────────────────────────────────
  const [editing,      setEditing]      = useState(false);
  const [timezone,     setTimezone]     = useState(org.timezone);
  const [billingEmail, setBillingEmail] = useState(org.billingEmail ?? "");
  const [orgSaving,    setOrgSaving]    = useState(false);
  const [orgError,     setOrgError]     = useState("");
  const [orgSaved,     setOrgSaved]     = useState(false);

  async function handleSaveOrg() {
    setOrgSaving(true);
    setOrgError("");
    setOrgSaved(false);
    try {
      const res  = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone, billingEmail: billingEmail || null }),
      });
      const data = await res.json();
      if (!res.ok) { setOrgError(data.error ?? "Error al guardar"); return; }
      setOrgSaved(true);
      setEditing(false);
    } catch {
      setOrgError("No se pudo conectar al servidor");
    } finally {
      setOrgSaving(false);
    }
  }

  // ── Threshold state ─────────────────────────────────────────────
  const [thresholdPct,    setThresholdPct]    = useState(Math.round(org.autoProcessThreshold * 100));
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdError,  setThresholdError]  = useState("");
  const [thresholdSaved,  setThresholdSaved]  = useState(false);

  async function handleSaveThreshold() {
    setThresholdSaving(true);
    setThresholdError("");
    setThresholdSaved(false);
    try {
      const res  = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoProcessThreshold: thresholdPct / 100 }),
      });
      const data = await res.json();
      if (!res.ok) { setThresholdError(data.error ?? "Error al guardar"); return; }
      setThresholdSaved(true);
    } catch {
      setThresholdError("No se pudo conectar al servidor");
    } finally {
      setThresholdSaving(false);
    }
  }

  // ── Invite user state ───────────────────────────────────────────
  const [showInvite,    setShowInvite]    = useState(false);
  const [inviteEmail,   setInviteEmail]   = useState("");
  const [inviteName,    setInviteName]    = useState("");
  const [inviteRole,    setInviteRole]    = useState<"admin" | "operator" | "viewer">("operator");
  const [inviteSaving,  setInviteSaving]  = useState(false);
  const [inviteError,   setInviteError]   = useState("");
  const [tempPassword,  setTempPassword]  = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteSaving(true);
    setInviteError("");
    try {
      const res  = await fetch("/api/v1/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, fullName: inviteName, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error ?? "Error al invitar"); return; }
      setTempPassword(data.tempPassword);
      setUsers(prev => [...prev, {
        id:          data.userId,
        email:       inviteEmail.toLowerCase().trim(),
        fullName:    inviteName || null,
        role:        inviteRole,
        isActive:    true,
        lastLoginAt: null,
        createdAt:   new Date().toISOString(),
      }]);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("operator");
    } catch {
      setInviteError("No se pudo conectar al servidor");
    } finally {
      setInviteSaving(false);
    }
  }

  // ── Webhook state ───────────────────────────────────────────────
  const [hooks,            setHooks]            = useState<WebhookData[]>(initialWebhooks);
  const [pendingDeleteHook, setPendingDeleteHook] = useState<string | null>(null);
  const [showHookForm, setShowHookForm] = useState(false);
  const [hookUrl,      setHookUrl]      = useState("");
  const [hookEvents,   setHookEvents]   = useState<string[]>(["completed", "review", "failed"]);
  const [hookSaving,   setHookSaving]   = useState(false);
  const [hookError,    setHookError]    = useState("");
  const [newSecret,    setNewSecret]    = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  function toggleEvent(ev: string) {
    setHookEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  }

  async function handleCreateHook(e: React.FormEvent) {
    e.preventDefault();
    setHookSaving(true); setHookError("");
    try {
      const res  = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: hookUrl, events: hookEvents }),
      });
      const data = await res.json();
      if (!res.ok) { setHookError(data.error ?? "Error al crear"); return; }
      setNewSecret(data.secret);
      setHooks(prev => [...prev, { ...data, secret: undefined }]);
      setHookUrl(""); setHookEvents(["completed", "review", "failed"]);
    } catch {
      setHookError("No se pudo conectar al servidor");
    } finally {
      setHookSaving(false);
    }
  }

  async function handleToggleHook(id: string, isActive: boolean) {
    setHooks(prev => prev.map(h => h.id === id ? { ...h, isActive } : h));
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        setHooks(prev => prev.map(h => h.id === id ? { ...h, isActive: !isActive } : h));
      }
    } catch {
      setHooks(prev => prev.map(h => h.id === id ? { ...h, isActive: !isActive } : h));
    }
  }

  async function handleDeleteHook(id: string) {
    setPendingDeleteHook(null);
    const prev = hooks.find(h => h.id === id);
    setHooks(hs => hs.filter(h => h.id !== id));
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok && prev) setHooks(hs => [...hs, prev]);
    } catch {
      if (prev) setHooks(hs => [...hs, prev]);
    }
  }

  async function copySecret(s: string) {
    await navigator.clipboard.writeText(s);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  }

  async function copyPassword(pwd: string) {
    await navigator.clipboard.writeText(pwd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function closeInvite() {
    setShowInvite(false);
    setTempPassword(null);
    setInviteError("");
    setCopied(false);
  }

  // ── API Keys state ──────────────────────────────────────────────
  const [apiKeysList,      setApiKeysList]      = useState<ApiKeyRow[]>([]);
  const [apiKeysLoaded,    setApiKeysLoaded]    = useState(false);
  const [apiKeysLoading,   setApiKeysLoading]   = useState(false);
  const [pendingDeleteKey,  setPendingDeleteKey]  = useState<string | null>(null);
  const [showKeyForm,    setShowKeyForm]    = useState(false);
  const [newKeyName,     setNewKeyName]     = useState("");
  const [keySaving,      setKeySaving]      = useState(false);
  const [keyError,       setKeyError]       = useState("");
  const [revealedKey,    setRevealedKey]    = useState<string | null>(null);
  const [keyCopied,      setKeyCopied]      = useState(false);

  // Limpiar la API Key revelada cuando el usuario sale del tab (WARN-06)
  useEffect(() => {
    if (tab !== "api_keys") setRevealedKey(null);
  }, [tab]);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const res = await fetch("/api/v1/settings/api-keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeysList(data);
      }
      setApiKeysLoaded(true);
    } catch {
      setApiKeysLoaded(true);
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "api_keys" && !apiKeysLoaded) loadApiKeys();
  }, [tab, apiKeysLoaded, loadApiKeys]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setKeySaving(true); setKeyError("");
    try {
      const res  = await fetch("/api/v1/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (!res.ok) { setKeyError(data.error ?? "Error al crear"); return; }
      setRevealedKey(data.rawKey);
      setApiKeysList(prev => [{ id: data.id, name: data.name, keyPrefix: data.keyPrefix,
        isActive: true, lastUsedAt: null, expiresAt: null, createdAt: data.createdAt }, ...prev]);
      setNewKeyName(""); setShowKeyForm(false);
    } catch {
      setKeyError("No se pudo conectar al servidor");
    } finally {
      setKeySaving(false);
    }
  }

  async function handleDeleteKey(id: string) {
    setPendingDeleteKey(null);
    const res = await fetch(`/api/v1/settings/api-keys/${id}`, { method: "DELETE" });
    if (res.ok) setApiKeysList(prev => prev.filter(k => k.id !== id));
  }

  async function copyKey(k: string) {
    await navigator.clipboard.writeText(k);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }

  // ── Audit log state ─────────────────────────────────────────────
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoaded,  setAuditLoaded]  = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);

  const loadAudit = useCallback(async (reset = true) => {
    setAuditLoading(true);
    const offset = reset ? 0 : auditEntries.length;
    try {
      const res = await fetch(`/api/v1/audit-log?offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        setAuditEntries(prev => reset ? data.entries : [...prev, ...data.entries]);
        setAuditHasMore(data.hasMore);
      }
      setAuditLoaded(true);
    } catch {
      setAuditLoaded(true);
    } finally {
      setAuditLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditEntries.length]);

  useEffect(() => {
    if (tab === "audit" && !auditLoaded) loadAudit(true);
  }, [tab, auditLoaded, loadAudit]);

  // ── Expense catalog state ───────────────────────────────────────
  const [cats, setCats]           = useState<ExpenseCategoryRow[]>(initialExpenseData?.categories ?? []);
  const [catSearch, setCatSearch] = useState("");
  const [capModal, setCapModal]   = useState<ExpenseCategoryRow | null>(null);
  const [capDaily,   setCapDaily]   = useState("");
  const [capMonthly, setCapMonthly] = useState("");
  const [capSaving,  setCapSaving]  = useState(false);
  const [capError,   setCapError]   = useState("");
  const [capSaved,   setCapSaved]   = useState(false);

  const filteredCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return cats;
    return cats.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.netsuiteAccountName ?? "").toLowerCase().includes(q)
    );
  }, [cats, catSearch]);

  function openCapModal(cat: ExpenseCategoryRow) {
    setCapModal(cat);
    setCapDaily(cat.dailyCap ? String(Math.round(Number(cat.dailyCap))) : "");
    setCapMonthly(cat.monthlyCap ? String(Math.round(Number(cat.monthlyCap))) : "");
    setCapError("");
    setCapSaved(false);
  }

  async function handleSaveCap() {
    if (!capModal) return;
    setCapSaving(true);
    setCapError("");
    const daily   = capDaily.trim()   === "" ? null : Number(capDaily);
    const monthly = capMonthly.trim() === "" ? null : Number(capMonthly);
    try {
      const res = await fetch(`/api/v1/expenses/categories/${capModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyCap: daily, monthlyCap: monthly }),
      });
      if (!res.ok) { setCapError("Error al guardar"); return; }
      setCats(prev => prev.map(c => c.id === capModal.id
        ? { ...c, dailyCap: daily != null ? String(daily) : null, monthlyCap: monthly != null ? String(monthly) : null }
        : c
      ));
      setCapSaved(true);
      setTimeout(() => setCapModal(null), 2000);
    } catch {
      setCapError("No se pudo conectar al servidor");
    } finally {
      setCapSaving(false);
    }
  }

  // ── Expense sync state ──────────────────────────────────────────
  const [syncingAction, setSyncingAction] = useState<string | null>(null);
  const [syncResult,    setSyncResult]    = useState<string | null>(null);
  const [syncError,     setSyncError]     = useState<string | null>(null);

  async function handleExpenseSync(action: string) {
    setSyncingAction(action);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/expenses/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncError(data.error ?? "Error en la sincronización"); return; }
      const r = data.results ?? {};
      const lines: string[] = [];
      if (r.categories)  lines.push(`Categorías: ${r.categories.synced} sincronizadas`);
      if (r.departments) lines.push(`Departamentos: ${r.departments.synced} sincronizados`);
      if (r.classes)     lines.push(`Clases: ${r.classes.synced} sincronizadas`);
      if (r.employees)   lines.push(`Empleados: ${r.employees.created} creados, ${r.employees.updated} actualizados`);
      setSyncResult(lines.join(" · ") || "Sincronización completada");
      setTimeout(() => setSyncResult(null), 10000);
      router.refresh();
    } catch {
      setSyncError("No se pudo conectar al servidor");
    } finally {
      setSyncingAction(null);
    }
  }

  // ── Expense submitters state ────────────────────────────────────
  type SubmitterRow = { id: string; email: string; fullName: string | null; lastLoginAt: string | null };
  const [submitters,       setSubmitters]       = useState<SubmitterRow[]>([]);
  const [submittersLoaded, setSubmittersLoaded] = useState(false);
  const [submittersLoading,setSubmittersLoading]= useState(false);
  const [resetPwd,         setResetPwd]         = useState<{ userId: string; password: string } | null>(null);
  const [resetLoading,     setResetLoading]     = useState<string | null>(null);
  const [pwdCopied,        setPwdCopied]        = useState(false);

  const loadSubmitters = useCallback(async () => {
    setSubmittersLoading(true);
    const res = await fetch("/api/v1/expenses/submitters");
    if (res.ok) {
      const data = await res.json();
      setSubmitters(data);
      setSubmittersLoaded(true);
    }
    setSubmittersLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "gastos" && !submittersLoaded && isAdmin) loadSubmitters();
  }, [tab, submittersLoaded, isAdmin, loadSubmitters]);

  async function handleResetPassword(userId: string) {
    setResetLoading(userId);
    const res = await fetch(`/api/v1/team/${userId}/reset-password`, { method: "POST" });
    const data = await res.json();
    setResetLoading(null);
    if (res.ok) { setResetPwd({ userId, password: data.tempPassword }); setPwdCopied(false); }
  }

  async function copyResetPwd(pwd: string) {
    await navigator.clipboard.writeText(pwd);
    setPwdCopied(true);
    setTimeout(() => setPwdCopied(false), 2000);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Topbar */}
      <div className="h-14 border-b border-border px-6 flex items-center shrink-0">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Configuración</h1>
          <p className="text-xs text-muted-foreground">{org.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border shrink-0 px-6 flex items-center">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-all duration-[120ms] border-b-2",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">

        {/* ── Organización ───────────────────────────────────────── */}
        {tab === "org" && (
          <div className="max-w-xl space-y-4">

            {/* Info general */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Información general</h2>
                {isAdmin && !editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                )}
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Nombre</p>
                      <p className="text-sm text-foreground">{org.name}</p>
                    </div>
                    <div>
                      <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Slug</p>
                      <p className="text-sm text-foreground">{org.slug}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                      Zona horaria
                    </label>
                    <NativeSelect
                      value={timezone}
                      onChange={e => setTimezone(e.target.value)}
                    >
                      {TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </NativeSelect>
                  </div>

                  <div>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                      Email de facturación
                    </label>
                    <input
                      type="email"
                      value={billingEmail}
                      onChange={e => setBillingEmail(e.target.value)}
                      placeholder="facturacion@empresa.com"
                      className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                    />
                  </div>

                  {orgError && <p className="text-xs text-destructive">{orgError}</p>}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSaveOrg}
                      disabled={orgSaving}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-all"
                    >
                      {orgSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      {orgSaving ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setTimezone(org.timezone); setBillingEmail(org.billingEmail ?? ""); setOrgError(""); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5"
                    >
                      <X className="w-3 h-3" /> Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Nombre",            value: org.name },
                      { label: "Slug",              value: org.slug },
                      { label: "Zona horaria",      value: org.timezone },
                      { label: "Email de facturación", value: org.billingEmail ?? "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">{label}</p>
                        <p className="text-sm text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                  {orgSaved && (
                    <p className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Configuración guardada
                    </p>
                  )}
                </>
              )}

              <div className="pt-3 border-t border-border flex items-center gap-4 flex-wrap">
                <div>
                  <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Estado</p>
                  <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", STATUS_BADGE[org.status] ?? "bg-secondary text-muted-foreground")}>
                    {STATUS_LABELS[org.status] ?? org.status}
                  </span>
                </div>
                <div>
                  <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Plan</p>
                  <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm bg-primary/10 text-primary capitalize">{plan}</span>
                </div>
                <div className="ml-auto">
                  <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Cuenta creada</p>
                  <p className="text-xs text-muted-foreground">{longDate(org.createdAt)}</p>
                </div>
              </div>
            </div>

            {/* Threshold (solo admins) */}
            {isAdmin && (
              <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Procesamiento automático</h2>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Umbral de confianza</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Los documentos con confianza igual o mayor se envían automáticamente a NetSuite.
                      Por debajo, pasan a revisión manual.
                    </p>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min={50} max={100} step={5}
                        value={thresholdPct}
                        onChange={e => { setThresholdPct(Number(e.target.value)); setThresholdSaved(false); }}
                        className="flex-1 accent-primary h-1.5 cursor-pointer"
                      />
                      <span className="text-sm font-semibold text-foreground tabular-nums w-12 text-right">{thresholdPct}%</span>
                    </div>
                    <div className="flex justify-between text-[0.6875rem] text-muted-foreground/60 mt-1 px-0.5">
                      <span>50% — más automático</span>
                      <span>100% — solo perfecto</span>
                    </div>
                  </div>
                  {thresholdError && <p className="text-xs text-destructive">{thresholdError}</p>}
                  {thresholdSaved && <p className="text-xs text-success">Umbral guardado correctamente</p>}
                  <button
                    onClick={handleSaveThreshold}
                    disabled={thresholdSaving || thresholdPct === Math.round(org.autoProcessThreshold * 100)}
                    className="text-xs font-medium px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground rounded-lg transition-all"
                  >
                    {thresholdSaving ? "Guardando..." : "Guardar umbral"}
                  </button>
                </div>
              </div>
            )}

            {/* Dry run */}
            {dryRunGranted && (
            <div className="bg-card rounded-xl border overflow-hidden"
              style={{ borderColor: dryRun ? "oklch(0.75 0.12 80 / 0.35)" : undefined }}>
              <div className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="mt-0.5 p-1.5 rounded-lg shrink-0"
                    style={{ backgroundColor: dryRun ? "oklch(0.94 0.04 80)" : "oklch(0.96 0 0)" }}>
                    <FlaskConical className="w-3.5 h-3.5" style={{ color: dryRun ? "oklch(0.55 0.14 80)" : "oklch(0.65 0 0)" }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-foreground">Modo prueba (Dry Run)</p>
                      {dryRun && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "oklch(0.94 0.04 80)", color: "oklch(0.50 0.14 80)" }}>
                          Activo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Cuando está activo, los documentos se validan contra NetSuite pero no se crean transacciones reales.
                      Útil para probar integraciones sin afectar datos de producción.
                    </p>
                    {dryRunError && <p className="text-xs text-destructive mt-1">{dryRunError}</p>}
                    {dryRunSaved && (
                      <p className="text-xs text-success flex items-center gap-1 mt-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {dryRun ? "Modo prueba activado" : "Modo prueba desactivado"}
                      </p>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <button
                    onClick={handleToggleDryRun}
                    disabled={dryRunSaving}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50",
                      dryRun
                        ? "text-warning border-warning/40 bg-warning/10 hover:bg-warning/20"
                        : "text-foreground border-border hover:bg-secondary"
                    )}
                  >
                    {dryRunSaving
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : dryRun
                        ? <X className="w-3 h-3" />
                        : <FlaskConical className="w-3 h-3" />
                    }
                    {dryRun ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </div>
            )}

            {!isAdmin && (
              <div className="flex items-start gap-3 bg-secondary/50 rounded-xl p-4">
                <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">Solo los administradores pueden modificar la configuración.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Subsidiarias ───────────────────────────────────────── */}
        {tab === "subsidiaries" && (
          <div className="max-w-2xl space-y-3">
            {subsidiaries.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-foreground">Sin subsidiarias configuradas</p>
                <p className="text-xs text-muted-foreground mt-1">Contacta a soporte para agregar subsidiarias</p>
              </div>
            ) : (
              subsidiaries.map(s => (
                <div key={s.id} className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">ID NS: {s.nsSubsidiaryId}</p>
                    </div>
                    <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", s.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                      {s.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[{ label: "Moneda", value: s.currency }, { label: "Locale", value: s.locale }].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">{label}</p>
                        <p className="text-xs text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[0.6875rem] text-muted-foreground mb-2">
                      Credenciales TBA de NetSuite — gestionadas por el administrador de DocuIA.
                      Para actualizarlas, contacta a soporte.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {["Consumer Key", "Consumer Secret", "Token ID"].map(label => (
                        <div key={label}>
                          <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">{label}</p>
                          <p className="text-[0.6875rem] font-mono text-muted-foreground tracking-widest">••••••••••</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-[0.6875rem] text-muted-foreground mt-3 pt-3 border-t border-border">
                    Configurada el {longDate(s.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Equipo ─────────────────────────────────────────────── */}
        {tab === "team" && (
          <div className="max-w-2xl space-y-4">

            {/* Invite form / temp password */}
            {isAdmin && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Invitar usuario</h2>
                  {!showInvite ? (
                    <button
                      onClick={() => setShowInvite(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Nuevo usuario
                    </button>
                  ) : (
                    <button onClick={closeInvite} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showInvite && (
                  <div className="p-5">
                    {tempPassword ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-success">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <p className="text-sm font-medium">Usuario creado correctamente</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Comparte esta contraseña temporal con el usuario. Deberá cambiarla en su primer inicio de sesión.
                        </p>
                        <div className="flex items-center gap-2 bg-secondary/60 border border-border rounded-lg px-3 py-2.5">
                          <code className="flex-1 text-sm font-mono text-foreground tracking-widest">{tempPassword}</code>
                          <button
                            onClick={() => copyPassword(tempPassword)}
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <button
                          onClick={closeInvite}
                          className="text-xs font-medium px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all"
                        >
                          Listo
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleInvite} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                              Email <span className="text-destructive">*</span>
                            </label>
                            <input
                              type="email"
                              value={inviteEmail}
                              onChange={e => setInviteEmail(e.target.value)}
                              placeholder="usuario@empresa.com"
                              required
                              className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                            />
                          </div>
                          <div>
                            <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                              Nombre completo
                            </label>
                            <input
                              type="text"
                              value={inviteName}
                              onChange={e => setInviteName(e.target.value)}
                              placeholder="Nombre Apellido"
                              className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">Rol</label>
                          <div className="flex gap-2">
                            {(["operator", "viewer", "admin"] as const).map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setInviteRole(r)}
                                className={cn(
                                  "flex-1 text-xs font-medium py-1.5 rounded-lg border transition-all",
                                  inviteRole === r
                                    ? "border-primary/60 bg-primary/10 text-primary"
                                    : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {ROLE_LABELS[r]}
                              </button>
                            ))}
                          </div>
                        </div>

                        {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}

                        <button
                          type="submit"
                          disabled={inviteSaving}
                          className="flex items-center gap-2 text-xs font-medium px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-all"
                        >
                          {inviteSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                          {inviteSaving ? "Creando..." : "Crear usuario"}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Users table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Miembros del equipo</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{users.length} usuario{users.length !== 1 ? "s" : ""}</p>
              </div>

              {users.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-foreground">Sin usuarios</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Usuario", "Rol", "Último acceso", "Estado"].map(h => (
                        <th key={h} className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-accent/40 transition-colors duration-[120ms]">
                        <td className="px-5 py-3">
                          <p className="text-xs font-medium text-foreground">{u.fullName ?? u.email}</p>
                          {u.fullName && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{u.email}</p>}
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", ROLE_BADGE[u.role] ?? "bg-secondary text-muted-foreground")}>
                            {ROLE_LABELS[u.role] ?? u.role}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-[0.6875rem] text-muted-foreground tabular-nums">
                          {u.lastLoginAt ? relativeDate(u.lastLoginAt) : "Nunca"}
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", u.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                            {u.isActive ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Webhooks ───────────────────────────────────────────── */}
        {tab === "webhooks" && (
          <div className="max-w-2xl space-y-4">

            {/* Secret reveal after creation */}
            {newSecret && (
              <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-warning">Guarda este secret ahora — no se mostrará de nuevo</p>
                <div className="flex items-center gap-2 bg-secondary/60 border border-border rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-foreground break-all">{newSecret}</code>
                  <button onClick={() => copySecret(newSecret)}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                    {secretCopied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setNewSecret(null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Ya lo guardé
                </button>
              </div>
            )}

            {/* Create form */}
            {isAdmin && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Webhooks</h2>
                  {!showHookForm ? (
                    <button onClick={() => setShowHookForm(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Nuevo webhook
                    </button>
                  ) : (
                    <button onClick={() => { setShowHookForm(false); setHookError(""); setNewSecret(null); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showHookForm && (
                  <form onSubmit={handleCreateHook} className="p-5 space-y-3">
                    <div>
                      <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                        URL del endpoint <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="url"
                        value={hookUrl}
                        onChange={e => setHookUrl(e.target.value)}
                        placeholder="https://tu-sistema.com/webhooks/docuia"
                        required
                        className="w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                      />
                    </div>

                    <div>
                      <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                        Eventos
                      </label>
                      <p className="text-[0.6875rem] text-muted-foreground mb-2 leading-relaxed">
                        <span className="text-success font-medium">Completado</span> — documento enviado a NetSuite.{" "}
                        <span className="text-warning font-medium">Revisión</span> — confianza baja, requiere atención.{" "}
                        <span className="text-destructive font-medium">Error</span> — falló el procesamiento.
                      </p>
                      <div className="flex gap-2">
                        {(["completed", "review", "failed"] as const).map(ev => (
                          <button key={ev} type="button" onClick={() => toggleEvent(ev)}
                            className={cn(
                              "flex-1 text-xs font-medium py-1.5 rounded-lg border transition-all",
                              hookEvents.includes(ev)
                                ? ev === "completed" ? "border-success/40 bg-success/10 text-success"
                                  : ev === "failed" ? "border-destructive/40 bg-destructive/10 text-destructive"
                                  : "border-warning/40 bg-warning/10 text-warning"
                                : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                            )}>
                            {ev === "completed" ? "Completado" : ev === "review" ? "Revisión" : "Error"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {hookError && <p className="text-xs text-destructive">{hookError}</p>}

                    <button type="submit" disabled={hookSaving || hookEvents.length === 0}
                      className="flex items-center gap-2 text-xs font-medium px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg transition-all">
                      {hookSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      {hookSaving ? "Creando..." : "Crear webhook"}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Hook list */}
            {hooks.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <Webhook className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">Sin webhooks configurados</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Los webhooks notifican a sistemas externos cuando un documento cambia de estado.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {hooks.map(h => (
                  <div key={h.id} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-xs font-mono text-foreground truncate">{h.url}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {h.events.map(ev => (
                            <span key={ev} className={cn(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded",
                              ev === "completed" ? "bg-success/10 text-success"
                                : ev === "failed" ? "bg-destructive/10 text-destructive"
                                : "bg-warning/10 text-warning"
                            )}>
                              {ev === "completed" ? "Completado" : ev === "review" ? "Revisión" : "Error"}
                            </span>
                          ))}
                          {h.lastStatusCode && (
                            <span className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded ml-1",
                              h.lastStatusCode >= 200 && h.lastStatusCode < 300
                                ? "bg-success/10 text-success"
                                : "bg-destructive/10 text-destructive"
                            )}>
                              {h.lastStatusCode}
                            </span>
                          )}
                        </div>
                        {h.lastTriggeredAt && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Último disparo: {new Date(h.lastTriggeredAt).toLocaleString("es-MX")}
                          </p>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleToggleHook(h.id, !h.isActive)}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1">
                            {h.isActive
                              ? <ToggleRight className="w-4 h-4 text-primary" />
                              : <ToggleLeft className="w-4 h-4" />}
                          </button>
                          {pendingDeleteHook === h.id ? (
                            <div className="flex items-center gap-1 ml-1">
                              <span className="text-[10px] text-muted-foreground">¿Eliminar?</span>
                              <button onClick={() => handleDeleteHook(h.id)}
                                className="text-[10px] font-semibold text-destructive hover:text-destructive/70 px-1.5 py-0.5 rounded transition-colors">
                                Sí
                              </button>
                              <button onClick={() => setPendingDeleteHook(null)}
                                className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors">
                                No
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setPendingDeleteHook(h.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-secondary/30 rounded-xl p-4 space-y-1.5">
              <p className="text-xs font-medium text-foreground">Firma de seguridad</p>
              <p className="text-xs text-muted-foreground">
                Cada request incluye el header <code className="text-primary bg-primary/10 px-1 py-0.5 rounded text-[10px]">X-DocuIA-Signature: sha256=...</code>.
                Verifica con HMAC-SHA256 usando tu secret para autenticar el origen.
              </p>
            </div>
          </div>
        )}

        {/* ── API Keys ────────────────────────────────────────────── */}
        {tab === "api_keys" && (
          <div className="max-w-2xl space-y-4">

            {/* Revealed key banner */}
            {revealedKey && (
              <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-warning">Guarda esta API Key ahora — no se mostrará de nuevo</p>
                <div className="flex items-center gap-2 bg-secondary/60 border border-border rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-foreground break-all">{revealedKey}</code>
                  <button onClick={() => copyKey(revealedKey)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                    {keyCopied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setRevealedKey(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Ya la guardé
                </button>
              </div>
            )}

            {isAdmin && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">API Keys</h2>
                  {!showKeyForm ? (
                    <button onClick={() => setShowKeyForm(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Nueva API Key
                    </button>
                  ) : (
                    <button onClick={() => { setShowKeyForm(false); setKeyError(""); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showKeyForm && (
                  <form onSubmit={handleCreateKey} className="p-5 space-y-3">
                    <div>
                      <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">
                        Nombre de la key <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={e => setNewKeyName(e.target.value)}
                        placeholder="Mi sistema ERP"
                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
                        required
                      />
                    </div>
                    {keyError && <p className="text-xs text-destructive">{keyError}</p>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={keySaving}
                        className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                        {keySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                        Generar
                      </button>
                      <button type="button" onClick={() => { setShowKeyForm(false); setKeyError(""); }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2">
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {apiKeysLoading ? (
                  <div className="py-16 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : apiKeysList.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center text-center">
                    <Key className="w-8 h-8 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium text-foreground">Sin API Keys</p>
                    <p className="text-xs text-muted-foreground mt-1">Las API Keys permiten acceso programático a DocuIA.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {apiKeysList.map(k => (
                      <div key={k.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground">{k.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{k.keyPrefix}••••••••••••</p>
                          {k.lastUsedAt && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Último uso: {new Date(k.lastUsedAt).toLocaleString("es-MX")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded",
                            k.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                            {k.isActive ? "Activa" : "Revocada"}
                          </span>
                          {isAdmin && (
                            pendingDeleteKey === k.id ? (
                              <div className="flex items-center gap-1 ml-1">
                                <span className="text-[10px] text-muted-foreground">¿Revocar?</span>
                                <button onClick={() => handleDeleteKey(k.id)}
                                  className="text-[10px] font-semibold text-destructive hover:text-destructive/70 px-1.5 py-0.5 rounded transition-colors">
                                  Sí
                                </button>
                                <button onClick={() => setPendingDeleteKey(null)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors">
                                  No
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setPendingDeleteKey(k.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-secondary/30 rounded-xl p-4 space-y-1.5">
              <p className="text-xs font-medium text-foreground">Autenticación</p>
              <p className="text-xs text-muted-foreground">
                Incluye el header <code className="text-primary bg-primary/10 px-1 py-0.5 rounded text-[10px]">Authorization: Bearer dk_...</code> en tus requests.
              </p>
            </div>
          </div>
        )}

        {/* ── Gastos ───────────────────────────────────────────────── */}
        {tab === "gastos" && (
          <div className="max-w-3xl space-y-5">

            {/* Summary counters */}
            {initialExpenseData && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Departamentos", value: initialExpenseData.departmentCount },
                  { label: "Clases / UT",   value: initialExpenseData.classCount },
                  { label: "Empleados",     value: initialExpenseData.submitterCount },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-xl px-4 py-3.5 text-center">
                    <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 uppercase tracking-[0.06em]">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Sync */}
            {isAdmin && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Sincronizar desde NetSuite</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Actualiza catálogos de categorías, departamentos, clases y empleados desde NetSuite. Cada sync es upsert — no elimina registros.
                  </p>
                </div>
                {syncError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{syncError}
                  </div>
                )}
                {syncResult && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />{syncResult}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { action: "sync_categories", label: "Categorías de gasto" },
                    { action: "sync_departments", label: "Departamentos" },
                    { action: "sync_classes",     label: "Clases / UT" },
                    { action: "sync_employees",   label: "Empleados" },
                  ] as const).map(({ action, label }) => (
                    <button
                      key={action}
                      onClick={() => handleExpenseSync(action)}
                      disabled={syncingAction !== null}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40"
                    >
                      {syncingAction === action
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      {label}
                    </button>
                  ))}
                </div>
                <div className="pt-1 border-t border-border">
                  <button
                    onClick={() => handleExpenseSync("sync_all")}
                    disabled={syncingAction !== null}
                    className="flex items-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {syncingAction === "sync_all"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />}
                    Sincronizar todo
                  </button>
                </div>
              </div>
            )}

            {/* Employees / expense_submitters */}
            {isAdmin && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Acceso de empleados</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Los empleados ingresan en <code className="text-primary bg-primary/10 px-1 rounded text-[10px]">/login</code> con su email corporativo.
                      Genera una contraseña temporal y compártela por mensaje o correo.
                    </p>
                  </div>
                  <button
                    onClick={() => { setSubmittersLoaded(false); loadSubmitters(); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {submittersLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Temp password reveal */}
                {resetPwd && (
                  <div className="mx-5 mt-4 p-3 rounded-lg bg-warning/5 border border-warning/20 space-y-2">
                    <p className="text-xs font-medium text-warning">Contraseña temporal generada — compártela una vez</p>
                    <div className="flex items-center gap-2 bg-secondary/60 border border-border rounded-lg px-3 py-2">
                      <code className="flex-1 text-sm font-mono text-foreground tracking-widest">{resetPwd.password}</code>
                      <button onClick={() => copyResetPwd(resetPwd.password)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {pwdCopied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <button onClick={() => setResetPwd(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                      Cerrar
                    </button>
                  </div>
                )}

                {submittersLoading && !submittersLoaded ? (
                  <div className="py-10 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : submitters.length === 0 ? (
                  <div className="py-10 flex flex-col items-center justify-center text-center">
                    <p className="text-sm font-medium text-foreground">Sin empleados sincronizados</p>
                    <p className="text-xs text-muted-foreground mt-1">Usa el botón "Empleados" del sync para importarlos desde NetSuite.</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card border-b border-border">
                        <tr>
                          <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Empleado</th>
                          <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Último acceso</th>
                          <th className="px-3 py-2.5 w-36" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {submitters.map(s => (
                          <tr key={s.id} className="hover:bg-accent/30 transition-colors">
                            <td className="px-5 py-3">
                              <p className="font-medium text-foreground">{s.fullName ?? s.email}</p>
                              {s.fullName && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{s.email}</p>}
                            </td>
                            <td className="px-5 py-3 text-muted-foreground tabular-nums">
                              {s.lastLoginAt ? relativeDate(s.lastLoginAt) : (
                                <span className="text-warning text-[10px] font-medium">Nunca ha ingresado</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <button
                                onClick={() => handleResetPassword(s.id)}
                                disabled={resetLoading === s.id}
                                className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-40 ml-auto"
                              >
                                {resetLoading === s.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <KeyRound className="w-3 h-3" />}
                                Contraseña temporal
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Categories */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Categorías de gasto</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cats.length} categorías sincronizadas desde NetSuite
                  </p>
                </div>
                {cats.length > 0 && (
                  <input
                    type="text"
                    value={catSearch}
                    onChange={e => setCatSearch(e.target.value)}
                    placeholder="Buscar categoría..."
                    className="w-52 shrink-0 bg-secondary/50 border border-border/60 rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                  />
                )}
              </div>

              {cats.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <Receipt className="w-8 h-8 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium text-foreground">Sin categorías sincronizadas</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    El administrador de DocuIA debe sincronizar los catálogos desde NetSuite.
                  </p>
                </div>
              ) : filteredCats.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-center">
                  <p className="text-xs text-muted-foreground">Sin resultados para &ldquo;{catSearch}&rdquo;</p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border">
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Categoría</th>
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Cuenta contable</th>
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Topes</th>
                        <th className="px-2 py-2.5 w-12" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredCats.map(cat => (
                        <tr key={cat.id} className="hover:bg-accent/30 transition-colors group">
                          <td className="px-5 py-3 font-medium text-foreground max-w-[200px]">
                            <p className="truncate">{cat.name}</p>
                          </td>
                          <td className="px-5 py-3 text-muted-foreground max-w-[180px]">
                            <p className="truncate">{cat.netsuiteAccountName ?? <span className="text-muted-foreground/40">—</span>}</p>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {cat.dailyCap ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                  <span className="opacity-60">día</span>
                                  {Number(cat.dailyCap).toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/40">Sin tope diario</span>
                              )}
                              {cat.monthlyCap ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                                  <span className="opacity-60">mes</span>
                                  {Number(cat.monthlyCap).toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/40">Sin tope mensual</span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <button
                              onClick={() => openCapModal(cat)}
                              className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-secondary transition-colors"
                            >
                              <Pencil className="w-3 h-3" /> Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Cap edit modal ────────────────────────────────────────── */}
        {capModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
            onClick={e => { if (e.target === e.currentTarget) setCapModal(null); }}
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1">Topes de gasto</p>
                  <h3 className="text-sm font-semibold text-foreground leading-snug truncate">{capModal.name}</h3>
                  {capModal.netsuiteAccountName && (
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 truncate">{capModal.netsuiteAccountName}</p>
                  )}
                </div>
                <button onClick={() => setCapModal(null)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Inputs */}
              <div className="space-y-3">
                {([
                  { label: "Tope diario", hint: "Límite por día calendario", value: capDaily, set: setCapDaily },
                  { label: "Tope mensual", hint: "Límite acumulado del mes", value: capMonthly, set: setCapMonthly },
                ] as const).map(({ label, hint, value, set }) => (
                  <div key={label}>
                    <label className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1 block">{label}</label>
                    <p className="text-[0.6875rem] text-muted-foreground/70 mb-1.5">{hint}</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                      <input
                        type="number"
                        min={0}
                        value={value}
                        onChange={e => set(e.target.value)}
                        placeholder="Sin límite"
                        className="w-full bg-secondary/50 border border-border/60 rounded-lg pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 tabular-nums"
                      />
                      {value && (
                        <button
                          type="button"
                          onClick={() => set("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {capError && <p className="text-xs text-destructive">{capError}</p>}

              {capSaved && (
                <p className="text-xs text-success flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Topes guardados
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSaveCap}
                  disabled={capSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {capSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {capSaving ? "Guardando..." : "Guardar topes"}
                </button>
                <button
                  onClick={() => setCapModal(null)}
                  className="px-4 py-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Cancelar
                </button>
              </div>

              <p className="text-[0.6875rem] text-muted-foreground/60 leading-relaxed">
                Deja en blanco para sin límite. Los valores en moneda local (COP).
              </p>
            </div>
          </div>
        )}

        {/* ── Auditoría ────────────────────────────────────────────── */}
        {tab === "audit" && (
          <div className="max-w-3xl space-y-4">
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-[-0.01em] text-foreground">Log de auditoría</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {auditEntries.length > 0 ? `${auditEntries.length} acciones` : "Acciones de usuarios y administradores"}
                  </p>
                </div>
                <button onClick={() => { setAuditLoaded(false); loadAudit(true); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  {auditLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScrollText className="w-3.5 h-3.5" />}
                  Actualizar
                </button>
              </div>

              {auditLoading && !auditLoaded ? (
                <div className="py-16 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : auditEntries.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <ScrollText className="w-8 h-8 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium text-foreground">Sin entradas de auditoría</p>
                  <p className="text-xs text-muted-foreground mt-1">Las acciones de los usuarios aparecerán aquí.</p>
                </div>
              ) : (
                <>
                  <div className="overflow-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card border-b border-border">
                        <tr>
                          {["Fecha", "Usuario", "Acción", "Recurso", "IP"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left font-medium text-muted-foreground uppercase tracking-wider text-[0.65rem] whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {auditEntries.map(e => (
                          <tr key={e.id} className="hover:bg-accent/20 transition-colors">
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                              {new Date(e.createdAt).toLocaleString("es-MX")}
                            </td>
                            <td className="px-4 py-2.5 text-foreground truncate max-w-[160px]">
                              {e.userEmail ?? e.userId ?? "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">{e.action}</code>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {e.resourceType ? `${e.resourceType}${e.resourceId ? ` #${e.resourceId}` : ""}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-muted-foreground text-[10px]">
                              {e.ipAddress ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {auditHasMore && (
                    <div className="px-5 py-3 border-t border-border">
                      <button
                        onClick={() => loadAudit(false)}
                        disabled={auditLoading}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {auditLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                        Cargar más entradas
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
