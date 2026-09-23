import { getFeature } from "@/lib/features";
import { clientIp } from "./request-ip";

function ipv4ToUint32(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4 || octets.some(value => !/^\d{1,3}$/.test(value))) return null;
  const values = octets.map(value => Number(value));
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return values.reduce((acc, value) => ((acc << 8) | value) >>> 0, 0);
}

function isAllowedIp(ip: string, allowlist: string[]): boolean {
  const ipValue = ipv4ToUint32(ip);
  for (const entry of allowlist) {
    const value = entry.trim();
    if (!value) continue;
    if (!value.includes("/")) {
      if (ip === value) return true;
      continue;
    }
    const [network, bitsRaw] = value.split("/");
    const prefix = Number(bitsRaw);
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
