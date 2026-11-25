"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { Drawer, EmptyState, Notice, PageFrame, PageHeader, SectionTitle, btn } from "@/components/kit";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { ApprovalMapTabs } from "../tabs";

export interface PersonOption { id: string; name: string; role: string }
export interface RoleRow { id: string; name: string; memberIds: string[]; substituteId: string | null; mapCount: number }
export interface AbsenceRow { id: string; userId: string; startsOn: string; endsOn: string }

const OFFLINE = "No se pudo conectar con DocuIA. Revisa tu conexión e inténtalo de nuevo.";

async function send(url: string, method: string, body: unknown, fallback: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => null) as { error?: unknown } | null;
  return { ok: false, error: typeof data?.error === "string" && data.error ? data.error : fallback };
}

// ── Fechas ────────────────────────────────────────────────────────────
// Se trabaja sobre «AAAA-MM-DD» (ya en la zona de la organización): nada depende
// de la zona del servidor ni del navegador.
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY_MS = 86_400_000;
const WINDOW = 35;

function ymd(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}
const dayNumber = (day: string) => { const { y, m, d } = ymd(day); return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS); };
function fromDayNumber(n: number): string {
  const dt = new Date(n * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
const short = (day: string) => { const { m, d } = ymd(day); return `${d} ${MONTHS[m - 1]}`; };
function span(from: string, to: string): string {
  if (from === to) return short(from);
  const a = ymd(from), b = ymd(to);
  return a.y === b.y && a.m === b.m ? `${a.d} → ${b.d} ${MONTHS[b.m - 1]}` : `${short(from)} → ${short(to)}`;
}

function initials(name: string) {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const roleLabel = (role: string) => TENANT_ROLE_LABELS[role as TenantRole] ?? role;

const inp = "w-full min-h-10 rounded-lg border border-[#D6D2C8] bg-white px-3 text-[13.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

// ── Pantalla ──────────────────────────────────────────────────────────
export function RolesClient({ people, roles, absences, today, formerNames }: {
  people: PersonOption[];
  roles: RoleRow[];
  absences: AbsenceRow[];
  /** Hoy en la zona de la organización (AAAA-MM-DD). */
  today: string;
  /** Personas en un rol que ya no pueden aprobar. */
  formerNames: Record<string, string>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [addingAbsence, setAddingAbsence] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [absenceError, setAbsenceError] = useState<string | null>(null);

  const signers = new Set(people.map((p) => p.id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? formerNames[id] ?? "Alguien";
  /** Hasta cuándo está fuera hoy, o null. */
  const awayUntil = (id: string) => absences.filter((a) => a.userId === id && a.startsOn <= today && a.endsOn >= today)
    .reduce<string | null>((max, a) => (max && max > a.endsOn ? max : a.endsOn), null);

  async function removeAbsence(id: string) {
    setRemoving(id); setAbsenceError(null);
    const result = await send(`/api/v1/contracts/approval-roles/absences/${id}`, "DELETE", undefined, "No se pudo quitar la ausencia.");
    setRemoving(null);
    if (!result.ok) { setAbsenceError(result.error); return; }
    router.refresh();
  }

  const newRole = <button type="button" onClick={() => setEditing("new")} className={btn("primary")}><Plus /> Rol nuevo</button>;

  return (
    <PageFrame>
      <PageHeader eyebrow="Contratos" title="Mapas de aprobación"
        description="Los mapas nombran roles. Aquí decides quién está en cada rol y quién lo cubre cuando nadie del rol puede firmar."
        actions={roles.length ? newRole : undefined} />
      <ApprovalMapTabs active="roles" className="mt-6" />

      {roles.length === 0 ? (
        <EmptyState className="mt-5" title="Todavía no hay roles" actions={newRole}>
          Un rol es un grupo de personas que firma un paso del mapa, como Jurídica o Gerencia; si alguien cambia, lo cambias aquí y no en cada mapa.
        </EmptyState>
      ) : (
        <ul className="mt-1" aria-label="Roles">
          {roles.map((r) => {
            const sub = r.substituteId;
            const subAway = sub ? awayUntil(sub) : null;
            return (
              <li key={r.id} className="grid gap-3 border-b border-border py-4 md:grid-cols-[200px_minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                  <h2 className="text-[14.5px] font-semibold">{r.name}</h2>
                  <span className="text-[12.5px] text-muted-foreground">{r.mapCount === 0 ? "En ningún mapa" : `En ${r.mapCount} mapa${r.mapCount === 1 ? "" : "s"}`}</span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
                  {r.memberIds.length === 0 && <span className="text-muted-foreground">Sin personas</span>}
                  {r.memberIds.map((id) => {
                    const until = awayUntil(id);
                    const former = !signers.has(id);
                    return (
                      <span key={id} className={cn("inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2.5 text-[12.5px]", (until || former) && "border-dashed text-muted-foreground")}>
                        <span aria-hidden className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-semibold", until || former ? "bg-secondary text-muted-foreground" : "bg-[#E6F2F0] text-[#0B5F56]")}>{initials(nameOf(id))}</span>
                        {nameOf(id)}
                        {former ? <span>· ya no puede aprobar</span> : until && <span>· fuera hasta el {short(until)}</span>}
                      </span>
                    );
                  })}
                  <ArrowRight aria-hidden className="mx-1 size-3.5 text-muted-foreground" />
                  {sub ? (
                    <span>
                      Si ninguno puede: <b className="font-semibold">{nameOf(sub)}</b> <span className="text-muted-foreground">· suplente</span>
                      {!signers.has(sub) ? <span className="text-tone-warn"> · ya no puede aprobar</span> : subAway && <span className="text-muted-foreground"> · fuera hasta el {short(subAway)}</span>}
                    </span>
                  ) : r.memberIds.length <= 1 ? (
                    <span className="text-tone-warn">Sin suplente: si su única persona no puede, firma un administrador</span>
                  ) : (
                    <span className="text-muted-foreground">Si ninguno puede: firma un administrador</span>
                  )}
                </div>
                <button type="button" onClick={() => setEditing(r)} className={btn("secondary", "sm", "self-start")} aria-label={`Editar el rol ${r.name}`}>Editar</button>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="away-title" className="mt-10">
        <SectionTitle title={<span id="away-title">Quién está fuera</span>} aside={`${span(today, fromDayNumber(dayNumber(today) + WINDOW - 1))}`} />
        {absenceError && <p role="alert" className="mt-3 text-sm text-tone-err">{absenceError}</p>}
        {absences.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">Nadie tiene una ausencia registrada.</p>
        ) : (
          <AbsenceCalendar absences={absences} roles={roles} today={today} signers={signers} nameOf={nameOf} removing={removing} onRemove={(id) => void removeAbsence(id)} />
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">Mientras alguien está fuera, sus firmas pasan a otra persona del rol o a su suplente.</p>
          <button type="button" onClick={() => setAddingAbsence(true)} disabled={people.length === 0} className={btn("secondary", "sm")}><Plus /> Registrar una ausencia</button>
        </div>
      </section>

      {editing && (
        <RoleDrawer key={editing === "new" ? "new" : editing.id} role={editing === "new" ? null : editing} people={people} formerNames={formerNames}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); router.refresh(); }} />
      )}
      {addingAbsence && <AbsenceDrawer people={people} today={today} onClose={() => setAddingAbsence(false)} onDone={() => { setAddingAbsence(false); router.refresh(); }} />}
    </PageFrame>
  );
}

// ── Calendario de ausencias ───────────────────────────────────────────
type Cover = { tone: "ok" | "warn" | "none"; signer: string | null };

/** Quién firma por la persona mientras está fuera, según sus roles. */
function coverFor(absence: AbsenceRow, roles: RoleRow[], absences: AbsenceRow[], signers: Set<string>, nameOf: (id: string) => string): Cover {
  const mine = roles.filter((r) => r.memberIds.includes(absence.userId));
  if (!mine.length) return { tone: "none", signer: null };
  const awayToo = (id: string) => absences.some((a) => a.id !== absence.id && a.userId === id && a.startsOn <= absence.endsOn && a.endsOn >= absence.startsOn);
  const can = (id: string) => id !== absence.userId && signers.has(id) && !awayToo(id);
  const coverers = new Set<string>();
  for (const role of mine) {
    const others = role.memberIds.filter(can);
    const who = others.length ? others : role.substituteId && can(role.substituteId) ? [role.substituteId] : [];
    if (!who.length) return { tone: "warn", signer: null };
    who.forEach((id) => coverers.add(id));
  }
  return { tone: "ok", signer: coverers.size === 1 ? nameOf([...coverers][0]) : null };
}

const BAR = {
  ok: { bar: "bg-[#E6F2F0] text-[#0B5F56]", text: "text-[#0B5F56]" },
  warn: { bar: "bg-[#FBF1DC] text-[#7A5606]", text: "text-[#7A5606]" },
  none: { bar: "bg-secondary text-muted-foreground", text: "text-muted-foreground" },
} as const;

function AbsenceCalendar({ absences, roles, today, signers, nameOf, removing, onRemove }: {
  absences: AbsenceRow[];
  roles: RoleRow[];
  today: string;
  signers: Set<string>;
  nameOf: (id: string) => string;
  removing: string | null;
  onRemove: (id: string) => void;
}) {
  const start = dayNumber(today);
  const ticks = [0, 7, 14, 21, 28];
  const grid = "md:grid-cols-[220px_minmax(0,1fr)_76px]";
  const gridLines = ticks.slice(1).map((t) => <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-line-soft" style={{ left: `${(t / WINDOW) * 100}%` }} />);

  return (
    <div className="mt-3">
      <div aria-hidden className={cn("hidden border-b border-line-soft pb-1.5 md:grid", grid)}>
        <span />
        <div className="relative h-4 text-[11.5px] tabular-nums text-muted-foreground">
          {ticks.map((t) => <span key={t} className="absolute top-0" style={{ left: `${(t / WINDOW) * 100}%` }}>{t === 0 ? `Hoy · ${short(today)}` : short(fromDayNumber(start + t))}</span>)}
        </div>
        <span />
      </div>
      <ul aria-label="Ausencias">
        {absences.map((a) => {
          const name = nameOf(a.userId);
          const roleNames = roles.filter((r) => r.memberIds.includes(a.userId)).map((r) => r.name);
          const cover = coverFor(a, roles, absences, signers, nameOf);
          const dates = span(a.startsOn, a.endsOn);
          const label = cover.tone === "warn" ? `${dates} · nadie lo cubre` : cover.signer ? `${dates} · firma ${cover.signer}` : dates;
          const s = dayNumber(a.startsOn) - start, e = dayNumber(a.endsOn) - start;
          const inWindow = s <= WINDOW - 1 && e >= 0;
          const left = (Math.max(0, s) / WINDOW) * 100;
          const right = ((Math.min(WINDOW - 1, e) + 1) / WINDOW) * 100;
          const width = right - left;
          const place = width >= 34 ? "inside" : right <= 62 ? "after" : "before";
          return (
            <li key={a.id} className={cn("grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b border-line-soft py-2.5", grid)}>
              <div className="min-w-0">
                <b className="block truncate text-[13.5px] font-semibold">{name}</b>
                <span className="block truncate text-[12px] text-muted-foreground">{roleNames.length ? roleNames.join(", ") : "No está en ningún rol"}</span>
              </div>
              <div className="relative h-7">
                {gridLines}
                {inWindow ? (
                  <>
                    <span title={label} className={cn("absolute inset-y-0.5 flex items-center overflow-hidden whitespace-nowrap rounded-md px-2 text-[12px] font-medium", BAR[cover.tone].bar)}
                      style={{ left: `${left}%`, width: `${width}%` }}>
                      {place === "inside" ? label : <span className="sr-only">{label}</span>}
                    </span>
                    {place !== "inside" && (
                      <span aria-hidden className={cn("absolute inset-y-0 flex items-center whitespace-nowrap text-[12px] font-medium", BAR[cover.tone].text)}
                        style={place === "after" ? { left: `calc(${right}% + 6px)` } : { right: `calc(${100 - left}% + 6px)` }}>
                        {label}
                      </span>
                    )}
                  </>
                ) : (
                  <span className={cn("absolute inset-y-0 right-0 flex items-center text-[12px] font-medium", BAR[cover.tone].text)}>Desde el {short(a.startsOn)} · {label}</span>
                )}
              </div>
              <button type="button" onClick={() => onRemove(a.id)} disabled={removing !== null} aria-label={`Quitar la ausencia de ${name} (${dates})`}
                className={btn("text", "sm", "justify-self-start md:justify-self-end")}>
                {removing === a.id && <Loader2 className="animate-spin" />} Quitar
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Rol nuevo / editar ────────────────────────────────────────────────
function RoleDrawer({ role, people, formerNames, onClose, onDone }: {
  role: RoleRow | null;
  people: PersonOption[];
  formerNames: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const valid = new Set(people.map((p) => p.id));
  const [name, setName] = useState(role?.name ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(() => (role?.memberIds ?? []).filter((id) => valid.has(id)));
  const [substituteId, setSubstituteId] = useState(() => (role?.substituteId && valid.has(role.substituteId) ? role.substituteId : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dropped = [...(role?.memberIds ?? []), ...(role?.substituteId ? [role.substituteId] : [])].filter((id) => !valid.has(id));

  function toggle(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (id === substituteId) setSubstituteId("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Escribe el nombre del rol."); return; }
    setBusy(true); setError(null);
    const body = { name: name.trim(), memberIds, substituteId: substituteId || null };
    const result = role
      ? await send(`/api/v1/contracts/approval-roles/${role.id}`, "PUT", body, "No se pudo guardar el rol.")
      : await send("/api/v1/contracts/approval-roles", "POST", body, "No se pudo crear el rol.");
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone();
  }

  async function remove() {
    if (!role) return;
    setBusy(true); setError(null);
    const result = await send(`/api/v1/contracts/approval-roles/${role.id}`, "DELETE", undefined, "No se pudo borrar el rol.");
    setBusy(false);
    if (!result.ok) { setError(result.error); setConfirmDelete(false); return; }
    onDone();
  }

  return (
    <Drawer title={role ? role.name : "Rol nuevo"} description="Quién firma por este rol y quién lo cubre." onClose={onClose} locked={busy} width={520}
      footer={<>
        {role && (
          <span className="mr-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-[13px]">¿Borrar el rol?</span>
                <button type="button" onClick={() => void remove()} disabled={busy} className={btn("danger", "sm")}>Sí, borrar</button>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className={btn("text", "sm")}>No</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className={btn("danger", "sm")}>Borrar rol</button>
            )}
          </span>
        )}
        <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
        <button type="submit" form="role-form" disabled={busy} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />} Guardar</button>
      </>}>
      <form id="role-form" onSubmit={save} className="flex flex-col gap-5.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Nombre</span>
          <input required autoFocus={!role} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: Jurídica" className={inp} />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1.5 text-[13px] font-semibold">Quién firma</legend>
          {people.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nadie puede aprobar todavía. Da el rol Administrador o Aprobador a alguien del equipo.</p>
          ) : people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13.5px]">
              <input type="checkbox" checked={memberIds.includes(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.name} <span className="text-muted-foreground">· {roleLabel(p.role)}</span></span>
            </label>
          ))}
          {dropped.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {dropped.map((id) => formerNames[id] ?? "Alguien").join(", ")} ya no {dropped.length === 1 ? "puede" : "pueden"} aprobar: al guardar sale{dropped.length === 1 ? "" : "n"} del rol.
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Suplente</span>
          <select value={substituteId} onChange={(e) => setSubstituteId(e.target.value)} className={inp}>
            <option value="">Sin suplente (firma un administrador)</option>
            {people.filter((p) => !memberIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">Firma cuando nadie del rol puede: subió el caso, está fuera o no firmó a tiempo.</span>
        </label>

        {error && <Notice tone="err" title={error} />}
      </form>
    </Drawer>
  );
}

// ── Registrar una ausencia ────────────────────────────────────────────
function AbsenceDrawer({ people, today, onClose, onDone }: { people: PersonOption[]; today: string; onClose: () => void; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) { setError("Elige a la persona."); return; }
    if (!startsOn || !endsOn) { setError("Elige las fechas de inicio y fin."); return; }
    if (endsOn < startsOn) { setError("La fecha de fin es anterior a la de inicio."); return; }
    setBusy(true); setError(null);
    const result = await send("/api/v1/contracts/approval-roles/absences", "POST", { userId, startsOn, endsOn }, "No se pudo registrar la ausencia.");
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone();
  }

  return (
    <Drawer title="Registrar una ausencia" description="Los dos días cuentan: la persona no firma desde el primero hasta el último." onClose={onClose} locked={busy} width={460}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={btn("secondary")}>Cancelar</button>
        <button type="submit" form="absence-form" disabled={busy} className={btn("primary")}>{busy && <Loader2 className="animate-spin" />} Registrar</button>
      </>}>
      <form id="absence-form" onSubmit={submit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Persona</span>
          <select required autoFocus value={userId} onChange={(e) => setUserId(e.target.value)} className={inp}>
            <option value="">Elige a alguien…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleLabel(p.role)}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Desde</span>
            <input type="date" required min={today} value={startsOn}
              onChange={(e) => { setStartsOn(e.target.value); if (endsOn && e.target.value > endsOn) setEndsOn(e.target.value); }} className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Hasta</span>
            <input type="date" required min={startsOn || today} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={inp} />
          </label>
        </div>
        {error && <Notice tone="err" title={error} />}
      </form>
    </Drawer>
  );
}
