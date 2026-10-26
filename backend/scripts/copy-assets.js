/**
 * Post-build asset copy: tsc emits only .js, but the migration runner reads
 * .sql files at runtime from its own directory (dist/db/ in production).
 * Copy every src/db/*.sql into dist/db/ so `node dist/server.js` can migrate.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDb = path.join(root, 'src', 'db');
const distDb = path.join(root, 'dist', 'db');

if (!existsSync(distDb)) {
  console.warn('[copy-assets] dist/db missing — run tsc first');
  process.exit(1);
}

let copied = 0;
for (const f of readdirSync(srcDb)) {
  if (f.endsWith('.sql')) {
    cpSync(path.join(srcDb, f), path.join(distDb, f));
    copied++;
    console.log(`[copy-assets] src/db/${f} → dist/db/${f}`);
  }
}
mkdirSync(distDb, { recursive: true }); // no-op guard for clarity
console.log(`[copy-assets] ${copied} migration file(s) copied`);
