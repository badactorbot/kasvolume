import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type Db = ReturnType<typeof drizzle<typeof schema>>;

let poolRef: pg.Pool | undefined;
let dbRef: Db | undefined;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return url;
}

function getPool(): pg.Pool {
  if (!poolRef) {
    poolRef = new Pool({ connectionString: requireDatabaseUrl() });
  }
  return poolRef;
}

function getDb(): Db {
  if (!dbRef) {
    dbRef = drizzle(getPool(), { schema });
  }
  return dbRef;
}

/** Lazy pool — safe to import during Vercel build (no env yet). */
export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getPool() as object, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(getPool())
      : value;
  },
});

/** Lazy db — connects on first query, not at module load. */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb() as object, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(getDb())
      : value;
  },
});

export * from "./schema";
