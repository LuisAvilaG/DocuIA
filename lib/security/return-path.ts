export function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return null;
  try {
    const base = "https://docuia.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || !/^\/(dashboard|workflow|history|exceptions|mappings|catalogs|statistics|settings|expenses|accounting|contracts|cases)(\/|$)/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}
