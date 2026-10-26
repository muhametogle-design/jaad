import { openDatabaseSync } from 'expo-sqlite';

import { DDL_V1, SCHEMA_VERSION } from './schema';
import { seedDefaultTypes } from './seed';

type Db = ReturnType<typeof openDatabaseSync>;

let dbInstance: Db | null = null;

/**
 * Lazily open the local database. All tables live on-device — the app is
 * fully functional with zero connectivity.
 */
export function getDb(): Db {
  if (!dbInstance) {
    const db = openDatabaseSync('jaad.db');
    db.execSync('PRAGMA foreign_keys = ON;');
    dbInstance = db;
  }
  return dbInstance;
}

/** Run migrations and first-run seeding. Called once from AppProvider. */
export function initDatabase(): void {
  const db = getDb();
  const row = db.getFirstSync<{ v: number }>(
    `SELECT CAST(value AS INTEGER) AS v FROM meta WHERE key = 'schema_version'`,
  );
  const current = row?.v ?? 0;

  if (current < 1) {
    db.withTransactionSync(() => {
      db.execSync(DDL_V1);
      db.runSync(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [
        String(SCHEMA_VERSION),
      ]);
      seedDefaultTypes();
    });
  }
}

/** Wipe every business table and re-seed defaults. Settings survive. */
export function resetDatabase(): void {
  const db = getDb();
  db.withTransactionSync(() => {
    db.execSync(`
      DELETE FROM sync_queue;
      DELETE FROM wastage;
      DELETE FROM credit_ledger;
      DELETE FROM payments;
      DELETE FROM sales_batch_alloc;
      DELETE FROM sales;
      DELETE FROM batch_inventory;
      DELETE FROM batches;
      DELETE FROM customers;
      DELETE FROM khat_types;
      DELETE FROM meta;
    `);
    db.execSync(DDL_V1);
    db.runSync(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [
      String(SCHEMA_VERSION),
    ]);
    seedDefaultTypes();
  });
}
