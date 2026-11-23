"use client";

import { useEffect } from "react";

// Keeps a tenant or platform-admin session alive. The access JWT lives 15 min;
// when it expires, same-origin /api calls start returning 401. This installs a
// one-time window.fetch interceptor that, on a 401 from an authenticated /api
// call, refreshes the token (single-flight) and retries the original request
// once. If the refresh fails, the session is truly dead and we send the user to
// the realm's login. Only touches /api/* responses with status 401 — RSC
// navigation, prefetch and non-401 responses pass straight through.

type Realm = "tenant" | "admin";

const REALMS: Record<Realm, { refresh: string; login: string; skip: string[] }> = {
  tenant: {
    refresh: "/api/v1/auth/refresh",
    login: "/login",
    // Endpoints that must never trigger a refresh+retry (avoids recursion / loops).
    skip: ["/api/v1/auth/refresh", "/api/v1/auth/login", "/api/v1/auth/logout"],
  },
  admin: {
    refresh: "/api/admin/auth/refresh",
    login: "/admin/login",
    skip: ["/api/admin/auth/refresh", "/api/admin/auth/login", "/api/admin/auth/logout"],
  },
};

const REFRESH_INTERVAL_MS = 8 * 60 * 1000;

interface RealmState { doRefresh: () => Promise<boolean>; refreshIfDue: () => Promise<boolean>; isDead: () => boolean }

// The page's own fetch, kept when the interceptor is installed (once).
let realFetch: typeof window.fetch | null = null;
const states = new Map<Realm, RealmState>();
// How many mounted <SessionRefresh> each realm has: only those are renewed.
const mounted = new Map<Realm, number>();

/** The refresh machinery of one realm (its own single flight and clock). */
function stateOf(realm: Realm): RealmState {
  const existing = states.get(realm);
  if (existing) return existing;
  const { refresh } = REALMS[realm];
  const send = realFetch!;
  let refreshing: Promise<boolean> | null = null;
  let lastRefreshAt = Date.now();
  // Only an explicit "not authorised" from the refresh means the session is
  // over; a 5xx or a dropped connection is not a reason to send people to login.
  let sessionDead = false;

  // Tabs share the cookies, so one refresh serves them all. The time of the
  // last one is shared too, and a lock keeps two tabs from sending the same
  // refresh token at once (the server reads that as a stolen token).
  const STAMP = `docuia-refresh:${realm}`;
  const sharedRefreshAt = () => { try { return Number(localStorage.getItem(STAMP)) || 0; } catch { return 0; } };

  async function refreshOnce(): Promise<boolean> {
    if (Date.now() - sharedRefreshAt() < 5_000) { lastRefreshAt = Date.now(); return true; }
    const r = await send(refresh, { method: "POST" }).catch(() => null);
    sessionDead = r !== null && (r.status === 401 || r.status === 403);
    if (r?.ok) {
      lastRefreshAt = Date.now();
      try { localStorage.setItem(STAMP, String(lastRefreshAt)); } catch { /* private mode */ }
    }
    return Boolean(r?.ok);
  }

  async function doRefresh(): Promise<boolean> {
    if (!refreshing) {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const run: Promise<boolean> = locks ? Promise.resolve(locks.request(STAMP, refreshOnce)) : refreshOnce();
      const flight = run
        .catch(() => false)
        .finally(() => {
          // Release the single-flight lock on the next tick so concurrent
          // callers that already awaited this promise get the result first.
          setTimeout(() => { refreshing = null; }, 0);
        });
      refreshing = flight;
      return flight;
    }
    return refreshing;
  }

  async function refreshIfDue(): Promise<boolean> {
    if (Date.now() - Math.max(lastRefreshAt, sharedRefreshAt()) < REFRESH_INTERVAL_MS) return true;
    return doRefresh();
  }

  const state: RealmState = { doRefresh, refreshIfDue, isDead: () => sessionDead };
  states.set(realm, state);
  return state;
}

function installInterceptor() {
  if (realFetch || typeof window === "undefined") return;
  const send = window.fetch.bind(window);
  realFetch = send;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await send(input, init);

    if (res.status !== 401) return res;

    // Resolve the request path to decide whether this is an auth-guarded /api call.
    let path = "";
    try {
      const url = typeof input === "string" ? input
        : input instanceof URL ? input.href
        : input instanceof Request ? input.url
        : String(input);
      path = new URL(url, window.location.origin).pathname;
    } catch {
      return res;
    }
    if (!path.startsWith("/api/")) return res;

    // Each area renews its own session. The interceptor is installed once for
    // the page, so the realm comes from the call, not from whichever layout
    // mounted first: an admin call was renewed with the tenant's endpoint and,
    // when that failed, sent to the tenant's login.
    const realm: Realm = path.startsWith("/api/admin/") ? "admin" : "tenant";
    if (!mounted.get(realm) || REALMS[realm].skip.some((s) => path.startsWith(s))) return res;

    const state = stateOf(realm);
    const ok = await state.doRefresh();
    if (!ok) {
      // Session is unrecoverable — bounce to login. A refresh that merely
      // failed to answer leaves the 401 to the caller, to try again later.
      if (state.isDead()) window.location.href = REALMS[realm].login;
      return res;
    }

    // Retry the original request once with the fresh cookie.
    return send(input, init);
  };
}

/** Mount inside an authenticated layout to keep API calls authenticated
 *  across the 15-minute access-token window. Renders nothing. */
export function SessionRefresh({ realm = "tenant" }: { realm?: Realm }) {
  useEffect(() => {
    installInterceptor();
    const state = stateOf(realm);
    mounted.set(realm, (mounted.get(realm) ?? 0) + 1);

    // Page navigations are server requests, not /api calls, so keep the short
    // access token fresh before they reach the proxy. Visibility covers a tab
    // returning from the background; the interval covers active long sessions.
    // Both stop when the layout goes away (after signing out, for one).
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void state.refreshIfDue();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => { void state.refreshIfDue(); }, REFRESH_INTERVAL_MS);

    return () => {
      mounted.set(realm, Math.max(0, (mounted.get(realm) ?? 1) - 1));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [realm]);
  return null;
}
