import pg from 'pg';
import { config } from '../config.js';

let pool: pg.Pool | null = null;

/**
 * Lazily-created connection pool (singleton). Tests inject an in-memory
 * pg-mem pool via setPoolForTest.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[pg] idle client error', err);
    });
  }
  return pool;
}

/** Test seam: swap the pool (pg-mem in vitest). */
export function setPoolForTest(p: pg.Pool): void {
  pool = p;
}

export function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Run `fn` inside a single BEGIN/COMMIT (ROLLBACK on error). */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
