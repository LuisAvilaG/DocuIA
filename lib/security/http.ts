import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "./request-ip";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getTenantSession } from "@/lib/auth/jwt";
import { requireAdminSession } from "@/lib/auth/admin";
import type { TenantArea } from "@/lib/auth/permissions";

export function isSameOriginMutation(req: Request, expectedOrigin: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (origin) return origin === expectedOrigin;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  // Browser sessions must demonstrate same-origin intent; headless bearer
  // integrations have no ambient cookies and don't need CSRF tokens.
  if (req.headers.has("cookie")) return site === "same-origin";
  return true;
}

export function tenantAreaForPath(path: string): TenantArea {
  if (path.startsWith("/api/v1/expenses/")) return "expenses";
  if (path.startsWith("/api/v1/contracts/")) return "contracts";
  if (/^\/api\/v1\/(settings|team|webhooks|audit-log)(\/|$)/.test(path) || path === "/api/v1/features/dry-run") return "settings";
  if (path.startsWith("/api/v1/auth/") || path === "/api/v1/features") return "profile";
  return "documents";
}

class BodyError extends Error {
  constructor(readonly status: number) { super("Invalid request body"); }
}

export async function readBoundedBody(req: Request, limit: number, timeoutMs = 30_000): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BodyError(413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new BodyError(408)); void reader.cancel(); }, timeoutMs);
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel(); throw new BodyError(413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** Applied at the route handler, independent of Proxy/middleware behavior. */
export function withApiSecurity<T extends unknown[]>(handler: (req: NextRequest, ...args: T) => Promise<Response | undefined>) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    try {
      const path = req.nextUrl.pathname;
      const configured = process.env.NEXT_PUBLIC_APP_URL;
      const origin = configured ? new URL(configured).origin : req.nextUrl.origin;
      if (!isSameOriginMutation(req, origin)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const publicAuth = /^\/api\/(?:v1|admin)\/auth\/(?:login|logout|refresh|forgot-password|reset-password)$/.test(path);
      let principal = clientIp(req.headers);
      if (publicAuth && /\/(refresh|logout)$/.test(path)) {
        const rl = await rateLimit(`session:${principal}`, { max: 120, windowSec: 60 });
        if (!rl.ok) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } });
      }
      if (path.startsWith("/api/v1/") && !publicAuth && path !== "/api/v1/contact") {
        const session = await getTenantSession({ area: tenantAreaForPath(path), permission: mutation ? "write" : "read" });
        if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        principal = `${session.orgId}:${session.sub}`;
      } else if ((path.startsWith("/api/admin/") || path.startsWith("/api/scripts/")) && !publicAuth) {
        const { error, session } = await requireAdminSession();
        if (error) return error;
        principal = session.sub;
      }
      // Public auth/contact have tighter dedicated limits inside their handlers.
      if (!publicAuth && path !== "/api/v1/contact" && !path.startsWith("/api/internal/")) {
        const expensive = /\/(upload|ocr|generate|improve|sync|word-template)$/.test(path) || (mutation && path === "/api/v1/contracts/cases") || (path.endsWith("/output") && req.nextUrl.searchParams.get("format") === "pdf");
        const rl = await rateLimit(`api:${expensive ? "cost" : mutation ? "write" : "read"}:${principal}`, { max: expensive ? 20 : mutation ? 120 : 600, windowSec: 60 });
        if (!rl.ok) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } });
      }
      let bounded = req;
      if (mutation && req.body) {
        const multipart = req.headers.get("content-type")?.startsWith("multipart/form-data");
        const limit = publicAuth || path === "/api/v1/contact" ? 16_384 : multipart ? (path === "/api/v1/contracts/cases" ? 60 : 21) * 1024 * 1024 : 2 * 1024 * 1024;
        const body = await readBoundedBody(req, limit);
        // Next can supply a Request from a different realm; copying explicitly
        // avoids losing its method when instanceof Request is false.
        bounded = new NextRequest(req.url, { method: req.method, headers: req.headers, signal: req.signal, body: body as BodyInit });
        if (req.headers.get("content-type")?.includes("application/json")) {
          try { JSON.parse(new TextDecoder().decode(body)); } catch { throw new BodyError(400); }
        }
      }
      const res = await handler(bounded, ...args);
      if (!res) throw new Error("Handler returned no response");
      res.headers.set("Cache-Control", "private, no-store");
      res.headers.set("X-Content-Type-Options", "nosniff");
      if (/\/(file|word-template)$/.test(path) && req.method === "GET") res.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      return res;
    } catch (err) {
      const status = err instanceof BodyError ? err.status : 500;
      if (status === 500) console.error("[api] request failed", err instanceof Error ? err.name : "Error", err instanceof Error ? err.stack?.split("\n").slice(1, 4).join("\n") : "");
      return NextResponse.json({ error: status === 413 ? "Solicitud demasiado grande" : status === 408 ? "Tiempo de carga agotado" : status === 400 ? "Solicitud inválida" : "Error interno" }, { status, headers: { "Cache-Control": "no-store" } });
    }
  };
}
