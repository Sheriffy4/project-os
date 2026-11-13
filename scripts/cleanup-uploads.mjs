import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../lib/db.mjs';
import { DB_PATH, UPLOAD_DIR } from '../lib/paths.mjs';

const db = openDb(DB_PATH);
const rows = db.prepare('SELECT stored_path FROM attachments').all();
const referenced = new Set(rows.map((row) => String(row.stored_path).split(/[\\/]/)[0]));
if (!existsSync(UPLOAD_DIR)) {
  console.log({ kept: [], removed: [] });
  db.close();
  process.exit(0);
}
const dirs = readdirSync(UPLOAD_DIR).filter((name) => statSync(join(UPLOAD_DIR, name)).isDirectory());
const removed = [];
const kept = [];
for (const dir of dirs) {
  if (referenced.has(dir)) {
    kept.push(dir);
  } else {
    rmSync(join(UPLOAD_DIR, dir), { recursive: true, force: true });
    removed.push(dir);
  }
}
console.log({ kept, removed });
db.close();
