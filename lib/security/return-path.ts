const TENANT_RETURN = /^\/(dashboard|workflow|history|exceptions|mappings|catalogs|statistics|settings|expenses|accounting|contracts|cases)(\/|$)/;
const ADMIN_RETURN = /^\/admin(\/(?!login(\/|$))|$)/;

function safePath(value: string | null, allowed: RegExp): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return null;
  try {
    const base = "https://docuia.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || !allowed.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

export function safeReturnPath(value: string | null): string | null {
  return safePath(value, TENANT_RETURN);
}

export function safeAdminReturnPath(value: string | null): string | null {
  return safePath(value, ADMIN_RETURN);
}
