import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

// Force TLS in production (or when DATABASE_SSL=true) so credentials/hashes and
// encrypted NS secrets never travel in clear. Left off in local dev where the
// docker Postgres has no TLS. Set DATABASE_SSL_NO_VERIFY=true for self-signed.
// TLS on when DATABASE_SSL=true or in production, UNLESS explicitly disabled with
// DATABASE_SSL=false (e.g. an internal EasyPanel Postgres on a private network
// that doesn't speak TLS). Secure-by-default; opt-out is explicit.
const useSsl = process.env.DATABASE_SSL === "true" || (process.env.DATABASE_SSL !== "false" && process.env.NODE_ENV === "production");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 10,
  ...(useSsl ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "true" } } : {}),
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
