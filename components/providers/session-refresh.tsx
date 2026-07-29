"use client";

import { useEffect } from "react";

// Keeps the tenant session alive. The access_token cookie lives 15 min; when it
// expires, same-origin /api calls start returning 401. This installs a one-time
// window.fetch interceptor that, on a 401 from an authenticated /api call,
// refreshes the token via /api/v1/auth/refresh (single-flight) and retries the
// original request once. If the refresh fails, the session is truly dead and we
// send the user to /login. Only touches /api/* responses with status 401 — RSC
// navigation, prefetch and non-401 responses pass straight through.

let installed = false;

// Endpoints that must never trigger a refresh+retry (avoids recursion / loops).
const SKIP = ["/api/v1/auth/refresh", "/api/v1/auth/login", "/api/v1/auth/logout"];

function installInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const realFetch = window.fetch.bind(window);
  let refreshing: Promise<boolean> | null = null;

  async function doRefresh(): Promise<boolean> {
    if (!refreshing) {
      refreshing = realFetch("/api/v1/auth/refresh", { method: "POST" })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => {
          // Release the single-flight lock on the next tick so concurrent
          // callers that already awaited this promise get the result first.
          setTimeout(() => { refreshing = null; }, 0);
        });
    }
    return refreshing;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await realFetch(input, init);

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

    if (!path.startsWith("/api/") || SKIP.some((s) => path.startsWith(s))) {
      return res;
    }

    const ok = await doRefresh();
    if (!ok) {
      // Session is unrecoverable — bounce to login.
      window.location.href = "/login";
      return res;
    }

    // Retry the original request once with the fresh cookie.
    return realFetch(input, init);
  };
}

/** Mount inside the tenant layout to keep API calls authenticated across the
 *  15-minute access-token window. Renders nothing. */
export function SessionRefresh() {
  useEffect(() => { installInterceptor(); }, []);
  return null;
}
