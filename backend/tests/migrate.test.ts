import { beforeAll, describe, expect, it } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';
import { setPoolForTest } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';

let db: IMemoryDb;
let pool: Pool;

beforeAll(() => {
  // noAstCoverageCheck: pg-mem's pg-adapter has an over-strict planner check
  // that rejects standard DDL (e.g. DEFAULT CURRENT_TIMESTAMP). Real Postgres
  // — the production target — handles all of it.
  db = newDb({ noAstCoverageCheck: true });
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool() as unknown as Pool;
  setPoolForTest(pool);
});

describe('migrations', () => {
  it('applies 001_init.sql and records the version', async () => {
    await runMigrations();
    const applied = await pool.query('SELECT version, name FROM schema_migrations ORDER BY version');
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0].version).toBe(1);
    expect(applied.rows[0].name).toMatch(/001_init/);

    // Key tables exist (probed individually — works on real pg and pg-mem).
    for (const t of [
      'devices',
      'khat_types',
      'batches',
      'batch_inventory',
      'customers',
      'sales',
      'sales_alloc',
      'payments',
      'wastage',
      'credit_ledger',
      'payments_stk',
      'webhook_events',
      'schema_migrations',
    ]) {
      const res = await pool.query(`SELECT 1 AS one FROM ${t} WHERE 1 = 0`);
      expect(res.rows).toHaveLength(0);
    }
  });

  it('is idempotent: re-running applies nothing new', async () => {
    await runMigrations();
    const applied = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(applied.rows).toHaveLength(1);
  });
});
