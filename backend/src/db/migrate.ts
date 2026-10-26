import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';
import { logger } from '../logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

/**
 * Forward-only, additive migrations. Each file 0NN_name.sql is applied once,
 * tracked in schema_migrations. Runs inside a single transaction.
 */
export async function runMigrations(): Promise<void> {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const applied = new Set(
    (await db.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map(
      (r) => r.version,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number(file.split('_')[0]);
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        version,
        file,
      ]);
      await client.query('COMMIT');
      logger.info({ version, file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

/** Standalone entry: `npm run migrate`. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(async () => {
      logger.info('migrations complete');
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error(err, 'migration failed');
      process.exit(1);
    });
}
