import { getFeature } from "@/lib/features";
import { clientIp } from "./request-ip";

function ipv4ToUint32(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4 || octets.some(value => !/^\d{1,3}$/.test(value))) return null;
  const values = octets.map(value => Number(value));
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return values.reduce((acc, value) => ((acc << 8) | value) >>> 0, 0);
}

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!text.includes(":")) return null;
  // A dotted IPv4 tail ("::ffff:203.0.113.10") is the last two groups.
  const tail = text.slice(text.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToUint32(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map(group => parseInt(group, 16));
}

/** An IPv4 address that arrived inside IPv6 ("::ffff:203.0.113.10") is that IPv4 address. */
function unmapped(ip: string): string {
  const text = ip.trim();
  const groups = ipv6Groups(text);
  if (groups && groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return text.replace(/^\[|\]$/g, "");
}

function sameV6Prefix(a: number[], b: number[], prefix: number): boolean {
  for (let i = 0; i < 8; i++) {
    const bits = Math.max(0, Math.min(16, prefix - i * 16));
    if (bits === 0) return true;
    const mask = (0xffff << (16 - bits)) & 0xffff;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
}

export function isAllowedIp(rawIp: string, allowlist: string[]): boolean {
  const ip = unmapped(rawIp);
  const ipValue = ipv4ToUint32(ip);
  const ipGroups = ipValue === null ? ipv6Groups(ip) : null;
  for (const entry of allowlist) {
    const value = entry.trim();
    if (!value) continue;
    if (!value.includes("/")) {
      const single = unmapped(value);
      if (ip === single) return true;
      // The same IPv6 address can be written in several ways.
      const groups = ipGroups ? ipv6Groups(single) : null;
      if (ipGroups && groups && sameV6Prefix(ipGroups, groups, 128)) return true;
      continue;
    }
    const [network, bitsRaw] = value.split("/");
    // Number("") is 0: an entry without its prefix would allow every address.
    if (!/^\d{1,3}$/.test(bitsRaw ?? "")) continue;
    const prefix = Number(bitsRaw);
    if (network.includes(":")) {
      const groups = ipv6Groups(network);
      if (ipGroups && groups && prefix <= 128 && sameV6Prefix(ipGroups, groups, prefix)) return true;
      continue;
    }
    const networkValue = ipv4ToUint32(network);
    if (ipValue === null || networkValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    if ((ipValue & mask) === (networkValue & mask)) return true;
  }
  return false;
}

/** Applies only after an organization user has authenticated. Public login and platform admin never call this. */
export async function isTenantIpAllowed(organizationId: string, requestHeaders: Headers): Promise<boolean> {
  const feature = await getFeature(organizationId, "ip_allowlist");
  if (!feature.isEnabled) return true;
  const raw = feature.config.allowed_ips as string[] | string | undefined;
  const allowlist = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  if (!allowlist.some(value => value.trim())) return true;

  const ip = clientIp(requestHeaders);
  return isAllowedIp(ip, allowlist);
}
