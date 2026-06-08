"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FeatureToggle } from "@/components/admin/feature-toggle";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, Building2, LayoutGrid, Cpu,
  Server, FileText, Activity,
  Map as MapIcon, Workflow, RefreshCw, Plug, BarChart3,
  Shield, Building, HardDrive, SlidersHorizontal,
  CheckCircle2, AlertTriangle, Loader2, Info, KeyRound, Eye, EyeOff, Trash2,
  Users, UserPlus, Mail, User, Receipt, Check, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/form-select";

const TABS = [
  { id: "overview",     label: "Resumen",      icon: LayoutGrid },
  { id: "features",     label: "Features",     icon: Cpu },
  { id: "subsidiaries", label: "Subsidiarias", icon: Server },
  { id: "users",        label: "Usuarios",     icon: Users },
  { id: "netsuite",     label: "NetSuite",     icon: Plug },
  { id: "gastos",       label: "Gastos",       icon: Receipt },
  { id: "ai",          label: "Config. IA",   icon: KeyRound },
];

const FEATURE_CATEGORIES = [
  { id: "all",         label: "Todos",         icon: SlidersHorizontal },
  { id: "expenses",    label: "Gastos",        icon: Receipt },
  { id: "extraction",  label: "Extracción AI", icon: Cpu },
  { id: "mapping",     label: "Mapeo",         icon: MapIcon },
  { id: "workflow",    label: "Workflow",       icon: Workflow },
  { id: "sync",        label: "Sync",          icon: RefreshCw },
  { id: "integration", label: "Integración",   icon: Plug },
  { id: "analytics",   label: "Analytics",     icon: BarChart3 },
  { id: "storage",     label: "Storage",       icon: HardDrive },
  { id: "security",    label: "Seguridad",     icon: Shield },
  { id: "enterprise",  label: "Enterprise",    icon: Building },
];

const PLAN_STYLES = {
  starter:    "bg-muted text-muted-foreground border-border",
  growth:     "bg-primary/10 text-primary border-primary/20",
  enterprise: "bg-violet-400/10 text-violet-400 border-violet-400/20",
};

export interface FullFeature {
  id: string;
  name: string;
  description: string | null;
  category: string;
  featureType: "boolean" | "config" | "boolean_config";
  defaultConfig: Record<string, unknown> | null;
  configSchema: unknown;
  planRequired: "starter" | "growth" | "enterprise";
  isBeta: boolean;
  sortOrder: number;
  adminGranted: boolean;
  tenantEnabled: boolean;
  isEnabled: boolean;
  config: Record<string, unknown>;
  notes: string | null;
  enabledBy: string | null;
}

export interface OrgSummary {
  id: string;
  name: string;
  plan: "starter" | "growth" | "enterprise";
  status: string;
  healthScore: number;
  docsThisMonth: number;
  usersCount: number;
  subsidiariesCount: number;
}

export interface SubsidiaryRow {
  id: string;
  name: string;
  nsSubsidiaryId: string;
  currency: string;
  isActive: boolean;
  updatedAt: Date;
  itemCount: number;
  vendorCount: number;
  locationCount: number;
}

export interface OrgUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string | Date;
}

interface NsConnection {
  id: string;
  environment: "sandbox" | "production";
  accountId: string;
  connectionStatus: string;
  connectionTestedAt: string | null;
  connectionError: string | null;
  scriptsInstalled: boolean;
  isActive: boolean;
  catalogScriptId: string | null;
  catalogDeployId: string | null;
  processScriptId: string | null;
  processDeployId: string | null;
}

interface Props {
  org: OrgSummary;
  features: FullFeature[];
  subsidiaries: SubsidiaryRow[];
}

export function ClientDetailContent({ org, features, subsidiaries }: Props) {
  const [tab, setTab]                       = useState("overview");
  const [featureCategory, setFeatureCategory] = useState("all");

  // Mapa sincronizado con server data para el contador "Activados"
  const [featureEnabledMap, setFeatureEnabledMap] = useState<Map<string, boolean>>(
    () => new Map(features.map(f => [f.id, f.adminGranted]))
  );
  // Cuando router.refresh() trae datos frescos del server, actualizar el mapa
  useEffect(() => {
    setFeatureEnabledMap(new Map(features.map(f => [f.id, f.adminGranted])));
  }, [features]);
  function handleFeatureEnabledChange(featureId: string, val: boolean) {
    setFeatureEnabledMap(prev => new Map(prev).set(featureId, val));
  }

  // ── Users state ───────────────────────────────────────────────────
  const [users,        setUsers]          = useState<OrgUser[] | null>(null);
  const [usersLoading, setUsersLoading]   = useState(false);
  const [usersError,   setUsersError]     = useState<string | null>(null);
  const [showNewUser,  setShowNewUser]    = useState(false);
  const [newUserEmail, setNewUserEmail]   = useState("");
  const [newUserName,  setNewUserName]    = useState("");
  const [newUserRole,  setNewUserRole]    = useState<"admin" | "operator" | "viewer" | "expense_submitter">("operator");
  const [newUserPass,  setNewUserPass]    = useState("");
  const [newUserErr,   setNewUserErr]     = useState<string | null>(null);
  const [newUserOk,    setNewUserOk]      = useState(false);
  const [newUserLoading, setNewUserLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/users`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      } else {
        setUsersError("No se pudieron cargar los usuarios");
      }
    } catch {
      setUsersError("Error de conexión al cargar usuarios");
    } finally {
      setUsersLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    if (tab === "users" && users === null) loadUsers();
  }, [tab, users, loadUsers]);

  async function handleCreateUser() {
    if (!newUserEmail.trim() || !newUserPass.trim()) return;
    setNewUserLoading(true);
    setNewUserErr(null);
    setNewUserOk(false);
    const res = await fetch(`/api/admin/clients/${org.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email:    newUserEmail.trim(),
        fullName: newUserName.trim() || null,
        role:     newUserRole,
        password: newUserPass,
      }),
    });
    const data = await res.json();
    setNewUserLoading(false);
    if (!res.ok) { setNewUserErr(data.error ?? "Error al crear usuario"); return; }
    setNewUserOk(true);
    setNewUserEmail("");
    setNewUserName("");
    setNewUserPass("");
    setNewUserRole("operator");
    setShowNewUser(false);
    setUsers(null);
    loadUsers();
    setTimeout(() => setNewUserOk(false), 3000);
  }

  // ── AI config state ───────────────────────────────────────────────
  const [aiConfigured, setAiConfigured]   = useState<boolean | null>(null);
  const [aiKeyHint,    setAiKeyHint]      = useState<string | null>(null);
  const [aiInput,      setAiInput]        = useState("");
  const [aiShowInput,  setAiShowInput]    = useState(false);
  const [aiLoading,    setAiLoading]      = useState(false);
  const [aiError,      setAiError]        = useState<string | null>(null);
  const [aiSuccess,    setAiSuccess]      = useState(false);

  const loadAiConfig = useCallback(async () => {
    const res = await fetch(`/api/admin/clients/${org.id}/ai-config`);
    if (res.ok) {
      const data = await res.json();
      setAiConfigured(data.configured);
      setAiKeyHint(data.keyHint ?? null);
    }
  }, [org.id]);

  useEffect(() => {
    if (tab === "ai" && aiConfigured === null) loadAiConfig();
  }, [tab, aiConfigured, loadAiConfig]);

  async function handleSaveAiKey() {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuccess(false);
    const res = await fetch(`/api/admin/clients/${org.id}/ai-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: aiInput.trim() }),
    });
    const data = await res.json();
    setAiLoading(false);
    if (!res.ok) { setAiError(data.error ?? "Error al guardar"); return; }
    setAiConfigured(true);
    setAiInput("");
    setAiSuccess(true);
    setTimeout(() => setAiSuccess(false), 3000);
    loadAiConfig();
  }

  async function handleClearAiKey() {
    setAiLoading(true);
    setAiError(null);
    const res = await fetch(`/api/admin/clients/${org.id}/ai-config`, { method: "DELETE" });
    setAiLoading(false);
    if (res.ok) {
      setAiConfigured(false);
      setAiKeyHint(null);
    }
  }

  // ── NetSuite connection state ──────────────────────────────────────────
  const [nsConns,       setNsConns]       = useState<NsConnection[] | null>(null);
  const [nsLoading,     setNsLoading]     = useState(false);
  const [nsActiveEnv,   setNsActiveEnv]   = useState<"sandbox" | "production">("sandbox");
  const [nsEditEnv,     setNsEditEnv]     = useState<"sandbox" | "production">("sandbox");
  const [nsForm,        setNsForm]        = useState({ accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" });
  const [nsFormSaving,  setNsFormSaving]  = useState(false);
  const [nsFormError,   setNsFormError]   = useState<string | null>(null);
  const [nsFormOk,      setNsFormOk]      = useState(false);

  const [nsScriptForm,     setNsScriptForm]     = useState({ catalogScriptId: "", catalogDeployId: "", processScriptId: "", processDeployId: "" });
  const [nsScriptSaving,   setNsScriptSaving]   = useState(false);
  const [nsScriptError,    setNsScriptError]     = useState<string | null>(null);
  const [nsScriptOk,       setNsScriptOk]        = useState(false);
  const [nsSwitching,   setNsSwitching]   = useState(false);
  const [nsSwitchError, setNsSwitchError] = useState<string | null>(null);
  const [pendingEnvSwitch, setPendingEnvSwitch] = useState<"sandbox" | "production" | null>(null);
  const [showNsCredentials, setShowNsCredentials] = useState(false);

  const loadNsConnections = useCallback(async () => {
    setNsLoading(true);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/connection`);
      if (res.ok) {
        const data = await res.json();
        setNsConns(data.connections ?? []);
        setNsActiveEnv(data.activeEnvironment ?? "sandbox");
      } else {
        setNsConns([]);
      }
    } catch {
      setNsConns([]);
    } finally {
      setNsLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    if (tab === "netsuite" && nsConns === null) loadNsConnections();
  }, [tab, nsConns, loadNsConnections]);

  async function handleSaveNsCredentials() {
    const { accountId, consumerKey, consumerSecret, tokenId, tokenSecret } = nsForm;
    if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) return;
    setNsFormSaving(true);
    setNsFormError(null);
    setNsFormOk(false);
    const res = await fetch(`/api/admin/clients/${org.id}/connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: nsEditEnv, accountId, consumerKey, consumerSecret, tokenId, tokenSecret }),
    });
    const data = await res.json();
    setNsFormSaving(false);
    if (!res.ok) { setNsFormError(data.error ?? "Error al guardar"); return; }
    setNsFormOk(true);
    setNsForm({ accountId: "", consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" });
    setNsConns(null);
    loadNsConnections();
    setTimeout(() => setNsFormOk(false), 3000);
  }

  // Sync script form when environment tab or connection data changes
  useEffect(() => {
    if (!nsConns) return;
    const conn = nsConns.find(c => c.environment === nsEditEnv);
    setNsScriptForm({
      catalogScriptId: conn?.catalogScriptId ?? "",
      catalogDeployId: conn?.catalogDeployId ?? "",
      processScriptId: conn?.processScriptId ?? "",
      processDeployId: conn?.processDeployId ?? "",
    });
  }, [nsEditEnv, nsConns]);

  async function handleSaveNsScripts() {
    setNsScriptSaving(true);
    setNsScriptError(null);
    setNsScriptOk(false);
    const res = await fetch(`/api/admin/clients/${org.id}/connection`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        environment: nsEditEnv,
        catalogScriptId: nsScriptForm.catalogScriptId || null,
        catalogDeployId: nsScriptForm.catalogDeployId || null,
        processScriptId: nsScriptForm.processScriptId || null,
        processDeployId: nsScriptForm.processDeployId || null,
      }),
    });
    const data = await res.json();
    setNsScriptSaving(false);
    if (!res.ok) { setNsScriptError(data.error ?? "Error al guardar"); return; }
    setNsScriptOk(true);
    setNsConns(null);
    loadNsConnections();
    setTimeout(() => setNsScriptOk(false), 3000);
  }

  async function handleSwitchEnvironment(env: "sandbox" | "production") {
    setNsSwitching(true);
    setNsSwitchError(null);
    const res = await fetch(`/api/admin/clients/${org.id}/environment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env }),
    });
    const data = await res.json();
    setNsSwitching(false);
    if (!res.ok) { setNsSwitchError(data.error ?? "Error al cambiar entorno"); return; }
    setNsActiveEnv(env);
  }

  // ── Subsidiaries local state ───────────────────────────────────────────
  const [subsList,        setSubsList]        = useState<SubsidiaryRow[]>(subsidiaries);
  const [editingSub,      setEditingSub]      = useState<string | null>(null);
  const [editSubForm,     setEditSubForm]     = useState({ name: "", nsSubsidiaryId: "", currency: "", isActive: true });
  const [subSaving,       setSubSaving]       = useState(false);
  const [subError,        setSubError]        = useState<string | null>(null);
  const [pendingDeleteSub, setPendingDeleteSub] = useState<string | null>(null);
  const [subDeleteErr,    setSubDeleteErr]    = useState<string | null>(null);
  const [showAddSub,      setShowAddSub]      = useState(false);
  const [addSubForm,      setAddSubForm]      = useState({ name: "", nsSubsidiaryId: "", currency: "MXN", locale: "es-MX" });
  const [addSubSaving,    setAddSubSaving]    = useState(false);
  const [addSubError,     setAddSubError]     = useState<string | null>(null);

  function startEditSub(s: SubsidiaryRow) {
    setEditingSub(s.id);
    setEditSubForm({ name: s.name, nsSubsidiaryId: s.nsSubsidiaryId, currency: s.currency, isActive: s.isActive });
    setSubError(null);
  }

  async function handleSaveSub(subId: string) {
    setSubSaving(true);
    setSubError(null);
    const res = await fetch(`/api/admin/clients/${org.id}/subsidiaries/${subId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editSubForm),
    });
    const data = await res.json();
    setSubSaving(false);
    if (!res.ok) { setSubError(data.error ?? "Error al guardar"); return; }
    setSubsList(prev => prev.map(s => s.id === subId ? { ...s, ...editSubForm } : s));
    setEditingSub(null);
  }

  async function handleDeleteSub(subId: string) {
    setSubDeleteErr(null);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/subsidiaries/${subId}`, { method: "DELETE" });
      if (res.ok) {
        setSubsList(prev => prev.filter(s => s.id !== subId));
        setPendingDeleteSub(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setSubDeleteErr(data.error ?? "Error al eliminar");
      }
    } catch {
      setSubDeleteErr("Error de conexión");
    }
  }

  async function handleAddSub() {
    if (!addSubForm.name.trim() || !addSubForm.nsSubsidiaryId.trim()) return;
    setAddSubSaving(true);
    setAddSubError(null);
    const res = await fetch(`/api/admin/clients/${org.id}/subsidiaries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subsidiaries: [addSubForm] }),
    });
    const data = await res.json();
    setAddSubSaving(false);
    if (!res.ok) { setAddSubError(data.error ?? "Error al crear"); return; }
    setShowAddSub(false);
    setAddSubForm({ name: "", nsSubsidiaryId: "", currency: "MXN", locale: "es-MX" });
    const freshRes = await fetch(`/api/admin/clients/${org.id}/subsidiaries`);
    if (freshRes.ok) {
      const fresh = await freshRes.json();
      setSubsList(fresh.subsidiaries ?? []);
    }
  }

  // ── User edit state ────────────────────────────────────────────────────
  const [editingUser,  setEditingUser]  = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ role: "admin", isActive: true, password: "" });
  const [userSaving,   setUserSaving]   = useState(false);
  const [userSaveErr,  setUserSaveErr]  = useState<string | null>(null);

  function startEditUser(u: OrgUser) {
    setEditingUser(u.id);
    setEditUserForm({ role: u.role, isActive: u.isActive, password: "" });
    setUserSaveErr(null);
  }

  async function handleSaveUser(userId: string) {
    setUserSaving(true);
    setUserSaveErr(null);
    const body: Record<string, unknown> = { role: editUserForm.role, isActive: editUserForm.isActive };
    if (editUserForm.password.length >= 8) body.password = editUserForm.password;
    const res = await fetch(`/api/admin/clients/${org.id}/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setUserSaving(false);
    if (!res.ok) { setUserSaveErr(data.error ?? "Error al guardar"); return; }
    setEditingUser(null);
    setUsers(null);
    loadUsers();
  }

  // ── Gastos (expense module) state ────────────────────────────────────
  interface ExpenseCategory {
    id: number;
    name: string;
    netsuiteCategoryId: string;
    netsuiteAccountName: string | null;
    dailyCap: string | null;
    monthlyCap: string | null;
    syncedAt: string | null;
  }
  interface ExpenseCounts { categories: number; departments: number; classes: number; employees: number }

  const [expenseCounts,     setExpenseCounts]     = useState<ExpenseCounts | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenseLoading,    setExpenseLoading]    = useState(false);
  const [expenseError,      setExpenseError]      = useState<string | null>(null);
  const [syncingAction,     setSyncingAction]     = useState<string | null>(null);
  const [syncResult,        setSyncResult]        = useState<string | null>(null);
  const [catSearch,         setCatSearch]         = useState("");
  const [capModal,          setCapModal]          = useState<ExpenseCategory | null>(null);
  const [capDaily,          setCapDaily]          = useState("");
  const [capMonthly,        setCapMonthly]        = useState("");
  const [capSaving,         setCapSaving]         = useState(false);
  const [capSaved,          setCapSaved]          = useState(false);
  const [capError,          setCapError]          = useState<string | null>(null);

  const filteredExpCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return expenseCategories;
    return expenseCategories.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.netsuiteAccountName ?? "").toLowerCase().includes(q)
    );
  }, [expenseCategories, catSearch]);

  const loadExpenseStatus = useCallback(async () => {
    setExpenseLoading(true);
    setExpenseError(null);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/expenses`);
      if (!res.ok) { setExpenseError("No se pudo cargar el estado del módulo de gastos"); return; }
      const data = await res.json();
      setExpenseCounts(data.counts);
      setExpenseCategories(data.categories ?? []);
    } catch {
      setExpenseError("Error de conexión");
    } finally {
      setExpenseLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    if (tab === "gastos" && expenseCounts === null) loadExpenseStatus();
  }, [tab, expenseCounts, loadExpenseStatus]);

  async function handleExpenseSync(action: string) {
    setSyncingAction(action);
    setSyncResult(null);
    setExpenseError(null);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { setExpenseError(data.error ?? "Error en la sincronización"); return; }
      const r = data.results ?? {};
      const lines: string[] = [];
      if (r.categories)  lines.push(`Categorías: ${r.categories.synced} sincronizadas`);
      if (r.departments) lines.push(`Departamentos: ${r.departments.synced} sincronizados`);
      if (r.classes)     lines.push(`Clases: ${r.classes.synced} sincronizadas`);
      if (r.employees)   lines.push(`Empleados: ${r.employees.created} creados, ${r.employees.updated} actualizados`);
      setSyncResult(lines.join(" · ") || "Sincronización completada");
      setExpenseCounts(null);
      loadExpenseStatus();
      setTimeout(() => setSyncResult(null), 8000);
    } catch {
      setExpenseError("Error de conexión con el servidor");
    } finally {
      setSyncingAction(null);
    }
  }

  function openCapModal(cat: ExpenseCategory) {
    setCapModal(cat);
    setCapDaily(cat.dailyCap ? String(Math.round(Number(cat.dailyCap))) : "");
    setCapMonthly(cat.monthlyCap ? String(Math.round(Number(cat.monthlyCap))) : "");
    setCapError(null);
    setCapSaved(false);
  }

  async function handleSaveCap() {
    if (!capModal) return;
    setCapSaving(true);
    setCapError(null);
    const daily   = capDaily.trim()   === "" ? null : Number(capDaily);
    const monthly = capMonthly.trim() === "" ? null : Number(capMonthly);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/expenses/categories?categoryId=${capModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyCap: daily != null ? String(daily) : null, monthlyCap: monthly != null ? String(monthly) : null }),
      });
      const data = await res.json();
      if (!res.ok) { setCapError(data.error ?? "Error al guardar"); return; }
      setExpenseCategories(prev => prev.map(c =>
        c.id === capModal.id
          ? { ...c, dailyCap: daily != null ? String(daily) : null, monthlyCap: monthly != null ? String(monthly) : null }
          : c
      ));
      setCapSaved(true);
      setTimeout(() => setCapModal(null), 900);
    } catch {
      setCapError("No se pudo conectar al servidor");
    } finally {
      setCapSaving(false);
    }
  }

  const enabledCount = [...featureEnabledMap.values()].filter(Boolean).length;

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-4 shrink-0">
        <Link href="/admin/clients" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2.5 flex-1">
          <div className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">{org.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", PLAN_STYLES[org.plan])}>
                {org.plan}
              </span>
              <span className="text-xs text-muted-foreground">ID: {org.id}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-lg border border-border">
          <Activity className="w-3 h-3" />
          Health <span className="font-medium text-foreground ml-1">{org.healthScore}/100</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-6 flex items-center gap-0 shrink-0">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-all -mb-px",
              tab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="flex-1 p-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Documentos este mes", value: org.docsThisMonth.toLocaleString("es-MX") },
              { label: "Usuarios",            value: org.usersCount.toString() },
              { label: "Subsidiarias",        value: org.subsidiariesCount.toString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Features — siempre montado, oculto con style para preservar estado de los toggles */}
      <div className="flex-1 flex overflow-hidden" style={tab !== "features" ? { display: "none" } : undefined}>
          {/* Category sidebar */}
          <div className="w-44 border-r border-border bg-card/50 p-2 space-y-0.5 shrink-0 overflow-y-auto">
            {FEATURE_CATEGORIES.map(({ id: catId, label, icon: Icon }) => (
              <button
                key={catId}
                onClick={() => setFeatureCategory(catId)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left",
                  featureCategory === catId
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Features grid */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-foreground">Feature flags</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Los cambios se aplican inmediatamente.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                  Activados: {enabledCount}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">Total: {features.length}</span>
              </div>
            </div>

            {/* Todos los features siempre montados — display:none para ocultar categorías no activas.
                Esto evita que React desmonte/remonte y pierda el estado local del toggle. */}
            <div className="columns-1 xl:columns-2 gap-3">
              {features.map(f => (
                <div
                  key={f.id}
                  className="break-inside-avoid mb-3"
                  style={featureCategory !== "all" && f.category !== featureCategory ? { display: "none" } : undefined}
                >
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <FeatureToggle
                    feature={f as any}
                    orgId={org.id}
                    onEnabledChange={handleFeatureEnabledChange}
                  />
                </div>
              ))}
            </div>
          </div>
      </div>  {/* end Features — always mounted */}

      {/* Subsidiaries */}
      {tab === "subsidiaries" && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Subsidiarias</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Gestiona las subsidiarias configuradas para este cliente.</p>
              </div>
              <Button size="sm" onClick={() => { setShowAddSub(v => !v); setAddSubError(null); }}>
                <Server className="w-3.5 h-3.5" />
                Agregar
              </Button>
            </div>

            {/* Add form */}
            {showAddSub && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.06em]">Nueva subsidiaria</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nombre <span className="text-destructive">*</span></Label>
                    <Input value={addSubForm.name} onChange={e => setAddSubForm(f => ({ ...f, name: e.target.value }))} placeholder="Mi Empresa SA" disabled={addSubSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">NS Subsidiary ID <span className="text-destructive">*</span></Label>
                    <Input value={addSubForm.nsSubsidiaryId} onChange={e => setAddSubForm(f => ({ ...f, nsSubsidiaryId: e.target.value }))} placeholder="1" disabled={addSubSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Moneda</Label>
                    <Input value={addSubForm.currency} onChange={e => setAddSubForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} placeholder="MXN" maxLength={3} disabled={addSubSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Locale</Label>
                    <Input value={addSubForm.locale} onChange={e => setAddSubForm(f => ({ ...f, locale: e.target.value }))} placeholder="es-MX" disabled={addSubSaving} />
                  </div>
                </div>
                {addSubError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{addSubError}</p>}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleAddSub} disabled={addSubSaving || !addSubForm.name.trim() || !addSubForm.nsSubsidiaryId.trim()}>
                    {addSubSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Crear
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddSub(false)} disabled={addSubSaving}>Cancelar</Button>
                </div>
              </div>
            )}

            {subsList.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <Server className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">Sin subsidiarias</p>
                <p className="text-xs text-muted-foreground mt-1">Aún no se han configurado subsidiarias para este cliente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {subsList.map(s => (
                  <div key={s.id} className="bg-card border border-border rounded-xl p-4">
                    {editingSub === s.id ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.06em]">Editando: {s.name}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Nombre</Label>
                            <Input value={editSubForm.name} onChange={e => setEditSubForm(f => ({ ...f, name: e.target.value }))} disabled={subSaving} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">NS Subsidiary ID</Label>
                            <Input value={editSubForm.nsSubsidiaryId} onChange={e => setEditSubForm(f => ({ ...f, nsSubsidiaryId: e.target.value }))} disabled={subSaving} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Moneda</Label>
                            <Input value={editSubForm.currency} onChange={e => setEditSubForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} disabled={subSaving} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Estado</Label>
                            <NativeSelect
                              value={editSubForm.isActive ? "active" : "inactive"}
                              onChange={e => setEditSubForm(f => ({ ...f, isActive: e.target.value === "active" }))}
                              disabled={subSaving}
                            >
                              <option value="active">Activa</option>
                              <option value="inactive">Inactiva</option>
                            </NativeSelect>
                          </div>
                        </div>
                        {subError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{subError}</p>}
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => handleSaveSub(s.id)} disabled={subSaving}>
                            {subSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSub(null)} disabled={subSaving}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{s.name}</p>
                            <p className="text-[0.6875rem] text-muted-foreground font-mono mt-0.5">NS ID: {s.nsSubsidiaryId}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm bg-secondary text-muted-foreground">{s.currency}</span>
                            <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", s.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                              {s.isActive ? "Activa" : "Inactiva"}
                            </span>
                            <button onClick={() => startEditSub(s)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {pendingDeleteSub === s.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDeleteSub(s.id)}
                                  className="text-[0.6875rem] font-medium px-2 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                                >
                                  Confirmar
                                </button>
                                <button
                                  onClick={() => { setPendingDeleteSub(null); setSubDeleteErr(null); }}
                                  className="text-[0.6875rem] font-medium px-2 py-0.5 rounded bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setPendingDeleteSub(s.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {subDeleteErr && pendingDeleteSub === s.id && (
                          <p className="text-xs text-destructive mb-2">{subDeleteErr}</p>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: "Ítems",      count: s.itemCount },
                            { label: "Vendors",    count: s.vendorCount },
                            { label: "Ubicaciones", count: s.locationCount },
                          ].map(({ label, count }) => (
                            <div key={label} className="bg-secondary/40 rounded-lg p-2.5 text-center">
                              <p className="text-base font-semibold text-foreground tabular-nums">{count.toLocaleString()}</p>
                              <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Users */}
      {tab === "users" && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-2xl space-y-4">

            {/* Header + create button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Usuarios del cliente</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Gestiona los accesos al portal tenant.</p>
              </div>
              <Button size="sm" onClick={() => { setShowNewUser(v => !v); setNewUserErr(null); }}>
                <UserPlus className="w-3.5 h-3.5" />
                Nuevo usuario
              </Button>
            </div>

            {/* Success banner */}
            {newUserOk && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Usuario creado correctamente.
              </div>
            )}

            {/* Create form */}
            {showNewUser && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <p className="text-xs font-semibold text-foreground uppercase tracking-[0.06em] text-muted-foreground">Nuevo usuario</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
                    <Input
                      type="email"
                      placeholder="usuario@empresa.com"
                      value={newUserEmail}
                      onChange={e => setNewUserEmail(e.target.value)}
                      disabled={newUserLoading}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nombre completo</Label>
                    <Input
                      placeholder="Nombre Apellido"
                      value={newUserName}
                      onChange={e => setNewUserName(e.target.value)}
                      disabled={newUserLoading}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contraseña <span className="text-destructive">*</span></Label>
                    <Input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={newUserPass}
                      onChange={e => setNewUserPass(e.target.value)}
                      disabled={newUserLoading}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rol</Label>
                    <NativeSelect
                      value={newUserRole}
                      onChange={e => setNewUserRole(e.target.value as "admin" | "operator" | "viewer" | "expense_submitter")}
                      disabled={newUserLoading}
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operador</option>
                      <option value="viewer">Visor (solo lectura)</option>
                      <option value="expense_submitter">Empleado (gastos)</option>
                    </NativeSelect>
                  </div>
                </div>

                {newUserErr && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />{newUserErr}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateUser}
                    disabled={newUserLoading || !newUserEmail.trim() || !newUserPass.trim()}
                  >
                    {newUserLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Crear usuario
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewUser(false)} disabled={newUserLoading}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {/* Users list */}
            {usersLoading ? (
              <div className="py-10 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : usersError ? (
              <div className="py-10 flex flex-col items-center justify-center text-center gap-2">
                <p className="text-sm text-destructive">{usersError}</p>
                <button onClick={loadUsers} className="text-xs text-primary hover:underline">Reintentar</button>
              </div>
            ) : users && users.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <User className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">Sin usuarios</p>
                <p className="text-xs text-muted-foreground mt-1">Crea el primer usuario para este cliente.</p>
              </div>
            ) : users && users.length > 0 ? (
              <div className="space-y-2">
                {users.map(u => (
                  <div key={u.id} className="bg-card border border-border rounded-xl p-4">
                    {editingUser === u.id ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.06em]">Editando: {u.email}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Rol</Label>
                            <NativeSelect
                              value={editUserForm.role}
                              onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))}
                              disabled={userSaving}
                            >
                              <option value="admin">Admin</option>
                              <option value="operator">Operador</option>
                              <option value="viewer">Visor (solo lectura)</option>
                              <option value="expense_submitter">Empleado (gastos)</option>
                            </NativeSelect>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Estado</Label>
                            <NativeSelect
                              value={editUserForm.isActive ? "active" : "inactive"}
                              onChange={e => setEditUserForm(f => ({ ...f, isActive: e.target.value === "active" }))}
                              disabled={userSaving}
                            >
                              <option value="active">Activo</option>
                              <option value="inactive">Inactivo</option>
                            </NativeSelect>
                          </div>
                          <div className="space-y-1.5 col-span-2">
                            <Label className="text-xs">Nueva contraseña <span className="text-muted-foreground">(dejar en blanco para no cambiar)</span></Label>
                            <Input
                              type="password"
                              placeholder="Mínimo 8 caracteres"
                              value={editUserForm.password}
                              onChange={e => setEditUserForm(f => ({ ...f, password: e.target.value }))}
                              disabled={userSaving}
                            />
                          </div>
                        </div>
                        {userSaveErr && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{userSaveErr}</p>}
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => handleSaveUser(u.id)} disabled={userSaving}>
                            {userSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingUser(null)} disabled={userSaving}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{u.fullName || u.email}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Mail className="w-3 h-3 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm bg-secondary text-muted-foreground capitalize">{u.role}</span>
                          <span className={cn("text-[0.6875rem] font-medium px-2 py-0.5 rounded-sm", u.isActive ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground")}>
                            {u.isActive ? "Activo" : "Inactivo"}
                          </span>
                          <button onClick={() => startEditUser(u)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

          </div>
        </div>
      )}

      {/* Gastos */}
      {tab === "gastos" && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-3xl space-y-6">

            {/* Header */}
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" />
                Módulo de Gastos — Expense AI
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Gestiona el onboarding y configuración del módulo de gestión de gastos de empleados.
                El módulo debe estar activado en la pestaña Features (feature: <code className="bg-secondary px-1 rounded">expense_management</code>).
              </p>
            </div>

            {expenseError && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{expenseError}
              </div>
            )}
            {syncResult && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />{syncResult}
              </div>
            )}

            {/* Status counts */}
            {expenseLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando estado...
              </div>
            ) : expenseCounts && (
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Categorías", value: expenseCounts.categories },
                  { label: "Departamentos", value: expenseCounts.departments },
                  { label: "Clases / UT", value: expenseCounts.classes },
                  { label: "Empleados", value: expenseCounts.employees },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
                    <p className="text-xl font-semibold text-foreground tabular-nums">{value}</p>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Sync buttons */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-foreground">Sincronizar desde NetSuite</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Requiere conexión NS activa. Cada sync es upsert — no elimina registros existentes.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { action: "sync_categories",  label: "Categorías de gasto" },
                  { action: "sync_departments",  label: "Departamentos" },
                  { action: "sync_classes",      label: "Clases / UT" },
                  { action: "sync_employees",    label: "Empleados → expense_submitters" },
                ].map(({ action, label }) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={syncingAction !== null}
                    onClick={() => handleExpenseSync(action)}
                  >
                    {syncingAction === action
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />
                    }
                    {label}
                  </Button>
                ))}
              </div>
              <div className="pt-1 border-t border-border">
                <Button
                  size="sm"
                  disabled={syncingAction !== null}
                  onClick={() => handleExpenseSync("sync_all")}
                >
                  {syncingAction === "sync_all"
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />
                  }
                  Onboarding completo (sync todos)
                </Button>
              </div>
            </div>

            {/* Category caps table */}
            {expenseCategories.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">Topes por categoría</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {expenseCategories.length} categorías — haz clic en una fila para configurar topes
                    </p>
                  </div>
                  <input
                    type="text"
                    value={catSearch}
                    onChange={e => setCatSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="w-44 shrink-0 bg-secondary/50 border border-border/60 rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
                  />
                </div>

                <div className="overflow-auto max-h-[50vh]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr>
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Categoría</th>
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Cuenta contable</th>
                        <th className="px-5 py-2.5 text-left text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">Topes</th>
                        <th className="px-2 py-2.5 w-16" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(filteredExpCats.length ? filteredExpCats : expenseCategories).map(cat => (
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
                              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-secondary"
                            >
                              <SlidersHorizontal className="w-3 h-3" /> Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredExpCats.length === 0 && catSearch && (
                        <tr>
                          <td colSpan={4} className="px-5 py-8 text-center text-xs text-muted-foreground">
                            Sin resultados para &ldquo;{catSearch}&rdquo;
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Cap edit modal (superadmin) ──────────────────────────────── */}
      {capModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={e => { if (e.target === e.currentTarget) setCapModal(null); }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
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
                      <button type="button" onClick={() => set("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {capError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{capError}</p>}
            {capSaved && <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Topes guardados</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSaveCap}
                disabled={capSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {capSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {capSaving ? "Guardando..." : "Guardar topes"}
              </button>
              <button onClick={() => setCapModal(null)} className="px-4 py-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                Cancelar
              </button>
            </div>

            <p className="text-[0.6875rem] text-muted-foreground/60">Deja en blanco para sin límite. Valores en moneda local.</p>
          </div>
        </div>
      )}

      {/* AI Config */}
      {tab === "ai" && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-lg space-y-4">

            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-primary" />
                  API Key de Google Gemini
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Si se configura, este cliente usará su propia API key para la extracción con IA en lugar de la key global de la plataforma.
                </p>
              </div>

              {/* Status actual */}
              <div className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs",
                aiConfigured
                  ? "bg-success/10 border-success/20 text-success"
                  : "bg-secondary border-border text-muted-foreground"
              )}>
                {aiConfigured === null
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : aiConfigured
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  : <Info className="w-3.5 h-3.5 shrink-0" />
                }
                {aiConfigured === null
                  ? "Cargando..."
                  : aiConfigured
                  ? `Key configurada: ${aiKeyHint ?? "•••"}`
                  : "Sin key propia — usa la key global de la plataforma"
                }
              </div>

              {/* Input nueva key */}
              <div className="space-y-2">
                <p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">
                  {aiConfigured ? "Reemplazar key" : "Configurar key"}
                </p>
                <div className="relative">
                  <input
                    type={aiShowInput ? "text" : "password"}
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    placeholder="AIzaSy..."
                    autoComplete="off"
                    className="w-full bg-background border border-border rounded-lg px-3 py-[9px] pr-9 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-primary focus:shadow-[0_0_0_3px_oklch(0.48_0.15_182_/_0.12)]"
                  />
                  <button
                    type="button"
                    onClick={() => setAiShowInput(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {aiShowInput ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {aiError && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />{aiError}
                  </p>
                )}
                {aiSuccess && (
                  <p className="text-xs text-success flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />Key guardada correctamente
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveAiKey}
                    disabled={aiLoading || !aiInput.trim()}
                  >
                    {aiLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {aiConfigured ? "Actualizar key" : "Guardar key"}
                  </Button>
                  {aiConfigured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearAiKey}
                      disabled={aiLoading}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar key
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs font-medium text-foreground mb-2">¿Cómo funciona?</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">1.</span>
                  Si este cliente tiene una key propia, todos sus documentos la usarán para extracción con IA.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">2.</span>
                  Si no tiene key propia, se usa la <code className="bg-secondary px-1 rounded">GOOGLE_API_KEY</code> global de la plataforma.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">3.</span>
                  La key se guarda encriptada (AES-256-GCM) y nunca se expone completa en la interfaz.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* NetSuite */}
      {tab === "netsuite" && (
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-2xl space-y-6">

            {/* Environment switcher */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Plug className="w-4 h-4 text-primary" />
                  Entorno activo
                </h2>
                <p className="text-xs text-muted-foreground mt-1">El entorno activo determina cuál conexión de NetSuite se usa para procesar documentos.</p>
              </div>
              {nsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando...</div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    {(["sandbox", "production"] as const).map(env => {
                      const conn = nsConns?.find(c => c.environment === env);
                      const isActive = nsActiveEnv === env;
                      const isConnected = conn?.connectionStatus === "connected";
                      return (
                        <button
                          key={env}
                          onClick={() => { if (!isActive && isConnected) setPendingEnvSwitch(env); }}
                          disabled={isActive || !isConnected || nsSwitching}
                          className={cn(
                            "flex-1 rounded-xl border p-4 text-left transition-all",
                            isActive
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-card hover:border-border/80",
                            !isConnected && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-foreground capitalize">{env}</span>
                            {isActive && <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-medium">Activo</span>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-success" : "bg-muted-foreground")} />
                            <span className="text-[10px] text-muted-foreground">{conn ? conn.connectionStatus : "Sin configurar"}</span>
                          </div>
                          {conn && <p className="text-[10px] text-muted-foreground font-mono mt-1">{conn.accountId}</p>}
                        </button>
                      );
                    })}
                  </div>
                  {pendingEnvSwitch && (
                    <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                      <p className="text-xs text-foreground leading-relaxed">
                        Cambiar a <strong>{pendingEnvSwitch}</strong> — los documentos se procesarán en ese entorno a partir de ahora.
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={async () => { await handleSwitchEnvironment(pendingEnvSwitch); setPendingEnvSwitch(null); }}
                          disabled={nsSwitching}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-warning/20 text-foreground hover:bg-warning/30 transition-colors disabled:opacity-50"
                        >
                          {nsSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirmar"}
                        </button>
                        <button
                          onClick={() => setPendingEnvSwitch(null)}
                          disabled={nsSwitching}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {nsSwitchError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{nsSwitchError}</p>}
            </div>

            {/* Credentials form */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Credenciales TBA</h2>
                  <p className="text-xs text-muted-foreground mt-1">Configura o actualiza las credenciales de Token-Based Authentication para sandbox o producción.</p>
                </div>
                <button
                  onClick={() => setShowNsCredentials(v => !v)}
                  className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-secondary"
                >
                  {showNsCredentials ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showNsCredentials ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {(["sandbox", "production"] as const).map(env => (
                  <button
                    key={env}
                    onClick={() => setNsEditEnv(env)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      nsEditEnv === env ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {env}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Account ID <span className="text-destructive">*</span></Label>
                  <Input value={nsForm.accountId} onChange={e => setNsForm(f => ({ ...f, accountId: e.target.value }))} placeholder="TSTDRV-123456" disabled={nsFormSaving} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Consumer Key <span className="text-destructive">*</span></Label>
                    <Input type={showNsCredentials ? "text" : "password"} value={nsForm.consumerKey} onChange={e => setNsForm(f => ({ ...f, consumerKey: e.target.value }))} placeholder="••••••••" autoComplete="off" disabled={nsFormSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Consumer Secret <span className="text-destructive">*</span></Label>
                    <Input type={showNsCredentials ? "text" : "password"} value={nsForm.consumerSecret} onChange={e => setNsForm(f => ({ ...f, consumerSecret: e.target.value }))} placeholder="••••••••" autoComplete="off" disabled={nsFormSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Token ID <span className="text-destructive">*</span></Label>
                    <Input type={showNsCredentials ? "text" : "password"} value={nsForm.tokenId} onChange={e => setNsForm(f => ({ ...f, tokenId: e.target.value }))} placeholder="••••••••" autoComplete="off" disabled={nsFormSaving} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Token Secret <span className="text-destructive">*</span></Label>
                    <Input type={showNsCredentials ? "text" : "password"} value={nsForm.tokenSecret} onChange={e => setNsForm(f => ({ ...f, tokenSecret: e.target.value }))} placeholder="••••••••" autoComplete="off" disabled={nsFormSaving} />
                  </div>
                </div>
              </div>

              {nsFormError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{nsFormError}</p>}
              {nsFormOk && <p className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Credenciales guardadas correctamente</p>}

              <Button
                size="sm"
                onClick={handleSaveNsCredentials}
                disabled={nsFormSaving || !nsForm.accountId || !nsForm.consumerKey || !nsForm.consumerSecret || !nsForm.tokenId || !nsForm.tokenSecret}
              >
                {nsFormSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Guardar credenciales {nsEditEnv}
              </Button>
            </div>

            {/* Script IDs card */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Script IDs de NetSuite</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  IDs de los RESTlets desplegados en NetSuite para el entorno <span className="font-medium text-foreground">{nsEditEnv}</span>.
                  El catalog script se usa para consultas; el process script para crear facturas y órdenes de compra.
                </p>
              </div>

              {nsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando...</div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-2">Catalog Script (consultas)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Script ID</Label>
                        <Input
                          value={nsScriptForm.catalogScriptId}
                          onChange={e => setNsScriptForm(f => ({ ...f, catalogScriptId: e.target.value }))}
                          placeholder="customscript_docuia_catalog"
                          disabled={nsScriptSaving}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Deploy ID</Label>
                        <Input
                          value={nsScriptForm.catalogDeployId}
                          onChange={e => setNsScriptForm(f => ({ ...f, catalogDeployId: e.target.value }))}
                          placeholder="customdeploy_docuia_catalog"
                          disabled={nsScriptSaving}
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] mb-2">Process Script (crear documentos)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Script ID</Label>
                        <Input
                          value={nsScriptForm.processScriptId}
                          onChange={e => setNsScriptForm(f => ({ ...f, processScriptId: e.target.value }))}
                          placeholder="customscript_docuia_process"
                          disabled={nsScriptSaving}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Deploy ID</Label>
                        <Input
                          value={nsScriptForm.processDeployId}
                          onChange={e => setNsScriptForm(f => ({ ...f, processDeployId: e.target.value }))}
                          placeholder="customdeploy_docuia_process"
                          disabled={nsScriptSaving}
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {nsScriptError && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{nsScriptError}</p>}
              {nsScriptOk && <p className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Script IDs guardados correctamente</p>}

              <Button
                size="sm"
                onClick={handleSaveNsScripts}
                disabled={nsScriptSaving || nsLoading || !nsConns?.find(c => c.environment === nsEditEnv)}
              >
                {nsScriptSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Guardar script IDs {nsEditEnv}
              </Button>

              {!nsConns?.find(c => c.environment === nsEditEnv) && !nsLoading && (
                <p className="text-xs text-warning flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Guarda las credenciales TBA primero para poder configurar los script IDs.
                </p>
              )}
            </div>

          </div>
        </div>
      )}


    </div>
  );
}
