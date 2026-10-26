/**
 * In-memory node:sqlite shim implementing the small slice of the
 * expo-sqlite synchronous/async API the app uses. Lets repository logic,
 * the real schema and the real SQL run headlessly in Jest/CI.
 */
import { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync | null = null;

function d(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return db;
}

type Params = unknown[] | undefined;

export const mockSqliteDb = {
  execSync(source: string): void {
    d().exec(source);
  },

  runSync(source: string, params?: Params): { changes: number; lastInsertRowId: number } {
    const st = d().prepare(source);
    const r = st.run(...((params as any[]) ?? []));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  },

  async runAsync(source: string, params?: Params) {
    return this.runSync(source, params);
  },

  getFirstSync<T>(source: string, params?: Params): T | null {
    const st = d().prepare(source);
    return ((st.get(...((params as any[]) ?? [])) as T) ?? null);
  },

  getAllSync<T>(source: string, params?: Params): T[] {
    return d().prepare(source).all(...((params as any[]) ?? [])) as T[];
  },

  async getFirstAsync<T>(source: string, params?: Params) {
    return this.getFirstSync<T>(source, params);
  },

  async getAllAsync<T>(source: string, params?: Params) {
    return this.getAllSync<T>(source, params);
  },

  withTransactionSync(task: () => void): void {
    d().exec('BEGIN');
    try {
      task();
      d().exec('COMMIT');
    } catch (e) {
      d().exec('ROLLBACK');
      throw e;
    }
  },

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    d().exec('BEGIN');
    try {
      await task();
      d().exec('COMMIT');
    } catch (e) {
      d().exec('ROLLBACK');
      throw e;
    }
  },

  /** Test helper: drop everything and apply the DDL fresh. */
  __reset(ddl: string): void {
    if (db) {
      db.close();
      db = null;
    }
    this.execSync(ddl);
  },
};

export default {
  openDatabaseSync: () => mockSqliteDb,
};
