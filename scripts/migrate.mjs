// Runtime DB migrator — runs on container start before the server (see Dockerfile).
// Uses drizzle-orm's migrator (same __drizzle_migrations tracking as drizzle-kit),
// so it's idempotent: applies only pending migrations, no-ops when up to date.
// Depends only on `pg` + `drizzle-orm`, both bundled in the standalone image.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const useSsl = process.env.DATABASE_SSL === "true" || (process.env.DATABASE_SSL !== "false" && process.env.NODE_ENV === "production");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ...(useSsl ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "true" } } : {}),
});

try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("[migrate] base de datos al día");
} catch (err) {
  console.error("[migrate] falló:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await pool.end();
}
