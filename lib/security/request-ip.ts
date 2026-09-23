import { isIP } from "node:net";

/** Only enable behind a proxy that overwrites/appends X-Forwarded-For and
 * blocks direct access to the application port. Count from the trusted end. */
export function clientIp(headers: Headers): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) return "unknown";
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map(s => s.trim());
  const candidate = chain[chain.length - hops] ?? "";
  return isIP(candidate) ? candidate : "unknown";
}
