// One-shot script to drop the `articles` table — usage: node --env-file=.env scripts/reset-db.js
// After running, the next request to the app will auto-create the table
// with the current MCD-aligned schema (cf. src/lib/db.js initSchema).
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('Missing TURSO_DATABASE_URL in .env');
  process.exit(1);
}

const c = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const before = await c.execute("SELECT name FROM sqlite_master WHERE type='table'");
console.log('Tables before:', before.rows.map((r) => r.name).join(', ') || '(none)');

await c.execute('DROP TABLE IF EXISTS articles');

const after = await c.execute("SELECT name FROM sqlite_master WHERE type='table'");
console.log('Tables after:', after.rows.map((r) => r.name).join(', ') || '(none)');
console.log('Done. Restart the dev server — initSchema will recreate the articles table with the MCD schema.');
