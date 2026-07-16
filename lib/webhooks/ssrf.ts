import { lookup } from "node:dns/promises";
import net from "node:net";

// True if an IPv4 literal falls in a private/loopback/link-local/reserved range.
// Malformed input is treated as unsafe (fail closed).
export function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0)   return true;               // 0.0.0.0/8
  if (a === 10)  return true;               // 10.0.0.0/8
  if (a === 127) return true;               // loopback
  if (a === 169 && b === 254) return true;  // link-local (cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;   // loopback / unspecified
    if (lower.startsWith("fe80")) return true;            // link-local fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true; // not a valid IP → unsafe
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"]);

/**
 * Reject non-https URLs and any host that is (or resolves to) an internal
 * address. Called both when saving a webhook and again at delivery time, so a
 * DNS-rebind after save still can't reach the internal network (blind SSRF).
 */
export async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("URL de webhook inválida"); }
  if (u.protocol !== "https:") throw new Error("El webhook debe usar https://");

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error("Host de webhook no permitido");

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("El webhook no puede apuntar a una dirección interna");
    return;
  }

  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("No se pudo resolver el host del webhook");
  }
  if (addrs.length === 0) throw new Error("No se pudo resolver el host del webhook");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("El host del webhook resuelve a una dirección interna");
    }
  }
}
