import { openDb } from '../lib/db.mjs';
import { DB_PATH } from '../lib/paths.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/backup-db.mjs <target.db>');
  process.exit(1);
}

const db = openDb(DB_PATH);
db.exec(`VACUUM INTO '${String(target).replaceAll("'", "''")}'`);
db.close();
console.log(target);
