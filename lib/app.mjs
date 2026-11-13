import { openDb } from './db.mjs';
import { APP_ROOT, DB_PATH, UPLOAD_DIR } from './paths.mjs';

export { DB_PATH, UPLOAD_DIR };
export const ROOT = APP_ROOT;

/**
 * Opens the SQLite database and prepares the schema.
 * No demo project is created: an empty database is a valid starting point,
 * the web UI will open the new-project wizard.
 */
export function openApp() {
  return openDb(DB_PATH);
}
