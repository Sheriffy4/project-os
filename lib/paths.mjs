import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const APP_ROOT = resolve(__dirname, '..');
export const DATA_DIR = join(APP_ROOT, 'data');
export const DB_PATH = process.env.KB_DB || join(DATA_DIR, 'kb.db');
export const UPLOAD_DIR = process.env.KB_UPLOAD_DIR || join(DATA_DIR, 'uploads');
export const PROJECTS_DIR = join(APP_ROOT, 'projects');
