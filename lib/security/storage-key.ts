export function isOrgWordTemplateKey(key: unknown, orgId: string): key is string {
  if (typeof key !== "string" || key.includes("\\") || key.split("/").some(p => p === "." || p === "..")) return false;
  return key.startsWith(`contracts/${orgId}/flows/`) && /^contracts\/[^/]+\/flows\/[^/]+\/word-templates\/[^/]+$/.test(key);
}
