import { openDb, uid } from '../lib/db.mjs';
import { DB_PATH } from '../lib/paths.mjs';

const db = openDb(DB_PATH);

const ideas = db.prepare('SELECT id, status, rejection_reason, created_at FROM ideas ORDER BY created_at ASC').all();
const historyAsc = db.prepare('SELECT * FROM status_history WHERE idea_id = ? ORDER BY created_at ASC');
const activities = db.prepare(
  "SELECT details, created_at FROM activity WHERE entity_type = 'idea' AND entity_id = ? AND action = 'status' ORDER BY created_at ASC",
);
const insert = db.prepare(
  'INSERT INTO status_history(id, idea_id, from_status, to_status, comment, created_at) VALUES(?,?,?,?,?,?)',
);

let initialAdded = 0;
let activityAdded = 0;
let skipped = 0;

db.exec('BEGIN');
try {
  for (const idea of ideas) {
    const rows = historyAsc.all(idea.id);
    const hasInitial = rows.some((row) => row.from_status === '');

    if (!hasInitial) {
      const earliest = rows[0];
      const toStatus = earliest?.from_status || idea.status;
      insert.run(
        uid('sth_'),
        idea.id,
        '',
        toStatus,
        'Начальное состояние (backfill)',
        idea.created_at,
      );
      rows.push({ from_status: '', to_status: toStatus, created_at: idea.created_at });
      initialAdded += 1;
    } else {
      skipped += 1;
    }

    for (const activity of activities.all(idea.id)) {
      const match = String(activity.details || '').match(/^\s*(\S+)\s*(?:→|->)\s*(\S+)\s*$/);
      if (!match) continue;
      const [, fromStatus, toStatus] = match;
      const exists = rows.some(
        (row) =>
          row.from_status === fromStatus &&
          row.to_status === toStatus &&
          row.created_at === activity.created_at,
      );
      if (exists) continue;
      insert.run(
        uid('sth_'),
        idea.id,
        fromStatus,
        toStatus,
        toStatus === 'rejected' ? idea.rejection_reason || '' : '',
        activity.created_at,
      );
      rows.push({ from_status: fromStatus, to_status: toStatus, created_at: activity.created_at });
      activityAdded += 1;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const total = db.prepare('SELECT COUNT(*) AS n FROM status_history').get().n;
console.log(JSON.stringify({ ideas: ideas.length, initialAdded, activityAdded, skipped, total }, null, 2));
db.close();
