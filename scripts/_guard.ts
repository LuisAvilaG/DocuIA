// Scripts that write demo data or rewrite configuration are meant for a local
// database. This stops them when DATABASE_URL points anywhere else, unless the
// person running them says so on purpose (ALLOW_NON_LOCAL_DB=1).
export function refuseNonLocalDatabase(what: string): void {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL: treated as not local */ }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "db", "postgres"].includes(host);
  if (local && process.env.NODE_ENV !== "production") return;
  if (process.env.ALLOW_NON_LOCAL_DB === "1") {
    console.warn(`AVISO: ${what} se ejecuta contra una base que no es local (${host || "sin host"}).`);
    return;
  }
  console.error(`${what}: la base de datos no es local (${host || "DATABASE_URL sin host"}). ` +
    "Este script escribe datos de prueba o reescribe configuración; no se ejecuta contra otra base. " +
    "Si de verdad es lo que quieres, repite con ALLOW_NON_LOCAL_DB=1.");
  process.exit(1);
}
