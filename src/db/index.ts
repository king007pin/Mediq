import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "postgres://stub:stub@localhost:5432/stub";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __mediqCorpusPool?: Pool;
};

// Primary pool multiplexes up to 5 connections per warm Fluid Compute
// instance — Neon's free-tier per-role cap is much higher than this, and
// reusing warm instances keeps the footprint bounded. poolCorpus stays at
// max: 1 because Rivestack has a hard per-role cap with no pooler.
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    keepAlive: true,
  });

// Cache the singleton in every environment (incl. production) so accidental
// re-imports never open a second connection against the cap.
globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool);

// ── RAG corpus DB (sources + embeddings only) ────────────────────────────────
// Gated split: when RIVESTACK_DATABASE_URL is set the large RAG corpus lives on
// the secondary 2GB DB; otherwise it stays on the primary DB exactly as before
// (zero behaviour change). Rivestack has no connection pooler and a low
// per-role connection cap, so this pool keeps the smallest possible footprint
// per serverless instance (single connection, released as soon as idle).
const corpusUrl = process.env.RIVESTACK_DATABASE_URL;

export const poolCorpus: Pool = corpusUrl
  ? (globalForDb.__mediqCorpusPool ??
      new Pool({
        connectionString: corpusUrl,
        max: 1,
        idleTimeoutMillis: 3_000,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: true,
      }))
  : pool;

if (corpusUrl) {
  globalForDb.__mediqCorpusPool = poolCorpus;
}

export const dbCorpus = corpusUrl ? drizzle(poolCorpus) : db;

// The corpus DB (Rivestack) has a low per-role connection cap and no pooler.
// Retry transient connection-exhaustion errors with exponential backoff +
// jitter so a brief spike past the cap degrades to a slower response instead
// of a failed clinical query. No-op when the corpus is on the primary DB.
const RETRYABLE = new Set(["53300", "57P03", "08006", "08001", "08004", "57P01"]);

export async function corpusRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (!code || !RETRYABLE.has(code) || i === attempts - 1) throw e;
      lastErr = e;
      const backoff = Math.min(2_500, 150 * 2 ** i) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
