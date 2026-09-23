import { lookup } from "node:dns/promises";
import net, { BlockList } from "node:net";
import { request } from "node:https";

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
  if (a >= 224 || (a === 198 && (b === 18 || b === 19))) return true;
  if ((a === 192 && b === 0) || (a === 198 && b === 51) || (a === 203 && b === 0)) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) {
    // Accept only global unicast. This also excludes ALL IPv4-mapped spellings,
    // translation ranges, link-local /10, multicast and deprecated site-local.
    const global = new BlockList();
    global.addSubnet("2000::", 3, "ipv6");
    const reserved = new BlockList();
    reserved.addSubnet("2001::", 23, "ipv6");
    reserved.addSubnet("2001:db8::", 32, "ipv6");
    reserved.addSubnet("2002::", 16, "ipv6");
    reserved.addSubnet("3fff::", 20, "ipv6");
    return !global.check(ip, "ipv6") || reserved.check(ip, "ipv6");
  }
  return true; // not a valid IP → unsafe
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"]);

/**
 * Reject non-https URLs and any host that is (or resolves to) an internal
 * address. Delivery must pin this result to the socket via postPublicWebhook.
 */
export async function resolvePublicHttpsUrl(rawUrl: string) {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("URL de webhook inválida"); }
  if (u.protocol !== "https:") throw new Error("El webhook debe usar https://");
  if (u.username || u.password || (u.port && u.port !== "443")) throw new Error("Usa el puerto 443 y una URL sin credenciales");

  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error("Host de webhook no permitido");

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("El webhook no puede apuntar a una dirección interna");
    return { url: u, address: { address: host, family: net.isIP(host) } };
  }

  let addrs: Array<{ address: string; family: number }>;
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
  return { url: u, address: addrs[0] };
}

export async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  await resolvePublicHttpsUrl(rawUrl);
}

/** Pin validated DNS to the actual connection. HTTPS keeps the original SNI
 * and certificate check; Node request never follows redirects. */
export async function postPublicWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<number> {
  const { url, address } = await resolvePublicHttpsUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST", agent: false,
      headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, res => {
      resolve(res.statusCode ?? 0);
      res.destroy();
    });
    const timer = setTimeout(() => req.destroy(new Error("Webhook timeout")), 10_000);
    req.once("close", () => clearTimeout(timer));
    req.once("error", reject);
    req.end(body);
  });
}
