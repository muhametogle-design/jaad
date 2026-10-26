/**
 * src/db/index.js — JS entry point for the PostgreSQL connection pool.
 *
 * The canonical implementation is TypeScript (pool.ts) so it shares types
 * with the services; this module re-exports the same pool API for
 * JavaScript consumers. Run with `npx tsx` (dev) or the compiled `dist/`
 * output (production) — both resolve the import transparently.
 *
 * Usage:
 *   import { getPool } from './db/index.js';
 *   const pool = getPool(); // pg.Pool built from process.env.DATABASE_URL
 */
export { getPool, withTransaction, setPoolForTest } from './pool.js';
