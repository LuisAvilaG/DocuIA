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
  // Seed newly introduced product controls after migrations commit. PostgreSQL
  // cannot use an enum value in the same transaction where ALTER TYPE added it
  // (fresh installs apply all migration files together).
  await pool.query(`INSERT INTO features (id, name, description, category, feature_type, default_enabled, plan_required, is_beta, sort_order, product_key) VALUES
    ('contract_reference_archive', 'Archivo y rastreo de referencias', 'Indexa cartas e informes, enlaza referencias y coteja pertinencia.', 'contracts', 'boolean', true, 'growth', false, 117, 'contract_intelligence'),
    ('contract_large_documents', 'Documentos extensos en casos', 'Permite PDFs de hasta 150 MB procesados por páginas.', 'contracts', 'boolean', true, 'growth', false, 118, 'contract_intelligence')
    ON CONFLICT (id) DO NOTHING`);
  console.log("[migrate] base de datos al día");
} catch (err) {
  console.error("[migrate] falló:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await pool.end();
}
