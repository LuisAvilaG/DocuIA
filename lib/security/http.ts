import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "./request-ip";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromCookies, getTenantSession } from "@/lib/auth/jwt";
import { requireAdminSession } from "@/lib/auth/admin";
import { isProductActive } from "@/lib/products";
import type { TenantArea } from "@/lib/auth/permissions";

/**
 * Origins this app answers on: the configured public URL and the one the
 * browser actually reached through the reverse proxy (TLS terminates there, so
 * the server alone would see http:// and reject every https:// form).
 */
export function allowedOrigins(req: Request, configured: string | undefined): string[] {
  const out = new Set<string>();
  if (configured) { try { out.add(new URL(configured).origin); } catch { /* ignore bad config */ } }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
    out.add(`${proto}://${host}`);
  }
  if (!out.size) out.add(new URL(req.url).origin);
  return [...out];
}

export function isSameOriginMutation(req: Request, expectedOrigin: string | string[]): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (origin) return (Array.isArray(expectedOrigin) ? expectedOrigin : [expectedOrigin]).includes(origin);
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  // Browser sessions must demonstrate same-origin intent; headless bearer
  // integrations have no ambient cookies and don't need CSRF tokens.
  if (req.headers.has("cookie")) return site === "same-origin";
  return true;
}

const AP_API = /^\/api\/v1\/(workflow|documents|exceptions|history|mappings|catalog|catalogs)(\/|$)/;

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
      if (!isSameOriginMutation(req, allowedOrigins(req, process.env.NEXT_PUBLIC_APP_URL))) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const publicAuth = /^\/api\/(?:v1|admin)\/auth\/(?:login|logout|refresh|forgot-password|reset-password)$/.test(path);
      let principal = clientIp(req.headers);
      if (publicAuth && /\/(refresh|logout)$/.test(path)) {
        const rl = await rateLimit(`session:${principal}`, { max: 120, windowSec: 60 });
        if (!rl.ok) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } });
      }
      if (path.startsWith("/api/v1/") && !publicAuth && path !== "/api/v1/contact") {
        const session = await getTenantSession({ area: tenantAreaForPath(path), permission: mutation ? "write" : "read" });
        if (!session) {
          // 403 for a live session that lacks the permission: a 401 makes the
          // browser's SessionRefresh rotate the refresh token for nothing.
          const signedIn = await getSessionFromCookies();
          return signedIn
            ? NextResponse.json({ error: "No tienes permiso para esta acción" }, { status: 403 })
            : NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }
        principal = `${session.orgId}:${session.sub}`;
        // AP Automation APIs need the product itself, not only a role that
        // may read documents (a contracts-only tenant has no AP access).
        if (AP_API.test(path) && !await isProductActive(session.orgId, "ap_automation")) {
          return NextResponse.json({ error: "AP Automation no está activo para tu organización" }, { status: 403 });
        }
      } else if ((path.startsWith("/api/admin/") || path.startsWith("/api/scripts/")) && !publicAuth) {
        const { error, session } = await requireAdminSession();
        if (error) return error;
        principal = session.sub;
      }
      // Public auth/contact have tighter dedicated limits inside their handlers.
      if (!publicAuth && path !== "/api/v1/contact" && !path.startsWith("/api/internal/")) {
        const expensive = /\/(upload|ocr|generate|improve|sync|word-template)$/.test(path) || (mutation && path === "/api/v1/contracts/cases") || (path.endsWith("/output") && req.nextUrl.searchParams.get("format") === "pdf");
        const rl = await rateLimit(`api:${expensive ? "cost" : mutation ? "write" : "read"}:${principal}`, { max: expensive ? 40 : mutation ? 120 : 600, windowSec: 60 });
        if (!rl.ok) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } });
      }
      let bounded = req;
      if (mutation && req.body) {
        const multipart = req.headers.get("content-type")?.startsWith("multipart/form-data");
        const limit = publicAuth || path === "/api/v1/contact" ? 16_384 : multipart ? (path === "/api/v1/contracts/cases" ? 60 : path === "/api/v1/workflow/upload" ? 42 : 21) * 1024 * 1024 : 2 * 1024 * 1024;
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

/**
 * Content-Disposition that survives any file name: an ASCII fallback plus the
 * RFC 5987 UTF-8 form. Header values are ByteStrings, so a raw "–" or "“" in a
 * template name used to make the download throw.
 */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const clean = fileName.replace(/[\r\n"\\]/g, "").trim() || "archivo";
  const ascii = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
