import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUSES = [
  'inbox',
  'accepted',
  'in_progress',
  'needs_rework',
  'clarify',
  'implemented',
  'future',
  'rejected',
];

export const ENTITY_STATES = ['new', 'existing', 'n/a'];
export const KINDS = ['idea', 'comment', 'decision', 'question', 'research', 'source', 'task', 'audit'];
export const PRIORITIES = ['low', 'normal', 'high', 'critical'];
export const LINK_TYPES = ['related', 'duplicates', 'depends', 'contradicts', 'implements', 'source'];

export function uid(prefix = '') {
  return `${prefix}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export function now() {
  return new Date().toISOString();
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  initSchema(db);
  return db;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'concept',
      export_path TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '•',
      color TEXT NOT NULL DEFAULT '#e8722a',
      sort INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(project_id, key)
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES ideas(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'idea',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inbox',
      entity_state TEXT NOT NULL DEFAULT 'n/a',
      priority TEXT NOT NULL DEFAULT 'normal',
      author TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      rejection_reason TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      proof TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL,
      UNIQUE(from_id, to_id, type),
      CHECK (from_id <> to_id)
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL DEFAULT '',
      to_status TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sections_json TEXT NOT NULL DEFAULT '[]',
      task TEXT NOT NULL DEFAULT 'audit',
      brief TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      result TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_project ON ideas(project_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_section ON ideas(section_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_ideas_parent ON ideas(parent_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_idea ON attachments(idea_id);
    CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
    CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_status_history_idea ON status_history(idea_id, created_at);
  `);
  // Forward-compatible columns for existing databases.
  ensureColumn(db, 'ideas', 'resolution', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'ideas', 'proof', "TEXT NOT NULL DEFAULT ''");
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

export function logActivity(db, projectId, entityType, entityId, action, details = '') {
  db.prepare(
    'INSERT INTO activity(id, project_id, entity_type, entity_id, action, details, created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(uid('act_'), projectId, entityType, entityId, action, details, now());
}

export function mapProject(row) {
  if (!row) return null;
  return {
    ...row,
    meta: parseJson(row.meta_json, {}),
  };
}

export function mapSection(row) {
  if (!row) return null;
  return {
    ...row,
    meta: parseJson(row.meta_json, {}),
  };
}

export function mapIdea(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson(row.tags_json, []),
    meta: parseJson(row.meta_json, {}),
    attachment_count: Number(row.attachment_count ?? 0),
    child_count: Number(row.child_count ?? 0),
  };
}

export function listProjects(db) {
  return db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM ideas i WHERE i.project_id = p.id) AS idea_count,
        (SELECT COUNT(*) FROM sections s WHERE s.project_id = p.id) AS section_count
       FROM projects p ORDER BY p.created_at ASC`,
    )
    .all()
    .map(mapProject);
}

export function getProject(db, idOrSlug) {
  const row = db
    .prepare('SELECT * FROM projects WHERE id = ? OR slug = ? LIMIT 1')
    .get(idOrSlug, idOrSlug);
  if (!row) return null;
  const project = mapProject(row);
  project.sections = listSections(db, project.id);
  project.stats = getStats(db, project.id);
  return project;
}

export function createProject(db, data) {
  const createdAt = now();
  const id = data.id || uid('prj_');
  const slug =
    data.slug ||
    String(data.name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) ||
    id;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO projects(id, name, slug, description, stage, export_path, meta_json, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      data.name,
      slug,
      data.description ?? '',
      data.stage ?? 'concept',
      data.export_path ?? '',
      toJson(data.meta ?? {}),
      createdAt,
      createdAt,
    );

    const sections = Array.isArray(data.sections) ? data.sections : [];
    for (const [index, section] of sections.entries()) {
      createSection(db, id, { ...section, sort: section.sort ?? index });
    }
    logActivity(db, id, 'project', id, 'created', data.name);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getProject(db, id);
}

export function updateProject(db, id, patch) {
  const current = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!current) return null;
  const fields = [];
  const values = [];
  for (const key of ['name', 'slug', 'description', 'stage', 'export_path']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (patch.meta !== undefined) {
    fields.push('meta_json = ?');
    values.push(toJson(patch.meta));
  }
  if (!fields.length) return getProject(db, id);
  fields.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  logActivity(db, id, 'project', id, 'updated');
  return getProject(db, id);
}

export function listSections(db, projectId) {
  return db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM ideas i WHERE i.section_id = s.id) AS idea_count,
        (SELECT COUNT(*) FROM ideas i WHERE i.section_id = s.id AND i.status = 'inbox') AS inbox_count,
        (SELECT COUNT(*) FROM ideas i WHERE i.section_id = s.id AND i.status = 'clarify') AS clarify_count
       FROM sections s WHERE s.project_id = ? ORDER BY s.sort ASC, s.name ASC`,
    )
    .all(projectId)
    .map((row) => ({
      ...mapSection(row),
      idea_count: Number(row.idea_count ?? 0),
      inbox_count: Number(row.inbox_count ?? 0),
      clarify_count: Number(row.clarify_count ?? 0),
    }));
}

export function createSection(db, projectId, data) {
  const id = data.id || uid('sec_');
  const key =
    data.key ||
    String(data.name || 'section')
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) ||
    id;
  db.prepare(
    `INSERT INTO sections(id, project_id, key, name, description, icon, color, sort, meta_json, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    projectId,
    key,
    data.name,
    data.description ?? '',
    data.icon ?? '•',
    data.color ?? '#e8722a',
    Number(data.sort ?? 0),
    toJson(data.meta ?? {}),
    now(),
  );
  return mapSection(db.prepare('SELECT * FROM sections WHERE id = ?').get(id));
}

export function getSectionByKey(db, projectId, key) {
  return mapSection(
    db.prepare('SELECT * FROM sections WHERE project_id = ? AND key = ?').get(projectId, key),
  );
}

export function listIdeas(db, projectId, filters = {}) {
  const where = ['i.project_id = ?'];
  const params = [projectId];

  if (filters.section) {
    where.push('(s.key = ? OR s.id = ?)');
    params.push(filters.section, filters.section);
  }
  if (filters.status) {
    const statuses = String(filters.status).split(',').filter(Boolean);
    if (statuses.length) {
      where.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
  }
  if (filters.kind) {
    where.push('i.kind = ?');
    params.push(filters.kind);
  }
  if (filters.entity_state) {
    where.push('i.entity_state = ?');
    params.push(filters.entity_state);
  }
  if (filters.author) {
    where.push('i.author = ?');
    params.push(filters.author);
  }
  if (filters.parent === 'root') {
    where.push('i.parent_id IS NULL');
  } else if (filters.parent) {
    where.push('i.parent_id = ?');
    params.push(filters.parent);
  }
  if (filters.tag) {
    where.push('i.tags_json LIKE ?');
    params.push(`%${JSON.stringify(String(filters.tag))}%`);
  }
  if (filters.q) {
    const q = `%${String(filters.q).trim()}%`;
    where.push('(i.title LIKE ? OR i.body LIKE ? OR i.tags_json LIKE ? OR i.source LIKE ?)');
    params.push(q, q, q, q);
  }

  const limit = Math.min(Number(filters.limit ?? 1000) || 1000, 5000);
  const offset = Math.max(Number(filters.offset ?? 0) || 0, 0);

  const rows = db
    .prepare(
      `SELECT i.*, s.key AS section_key, s.name AS section_name, s.icon AS section_icon, s.color AS section_color,
        (SELECT COUNT(*) FROM attachments a WHERE a.idea_id = i.id) AS attachment_count,
        (SELECT COUNT(*) FROM ideas c WHERE c.parent_id = i.id) AS child_count
       FROM ideas i
       JOIN sections s ON s.id = i.section_id
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         i.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map(mapIdea);

  return rows;
}

export function getIdea(db, id) {
  const row = db
    .prepare(
      `SELECT i.*, s.key AS section_key, s.name AS section_name, s.icon AS section_icon, s.color AS section_color,
        p.name AS project_name, p.slug AS project_slug,
        (SELECT COUNT(*) FROM attachments a WHERE a.idea_id = i.id) AS attachment_count,
        (SELECT COUNT(*) FROM ideas c WHERE c.parent_id = i.id) AS child_count
       FROM ideas i
       JOIN sections s ON s.id = i.section_id
       JOIN projects p ON p.id = i.project_id
       WHERE i.id = ?`,
    )
    .get(id);
  if (!row) return null;
  const idea = mapIdea(row);
  idea.attachments = listAttachments(db, id);
  idea.children = listIdeas(db, idea.project_id, { parent: id, limit: 500 }).map((child) => ({
    ...child,
    body: child.body,
  }));
  idea.links = listLinks(db, id);
  idea.activity = db
    .prepare('SELECT * FROM activity WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 20')
    .all('idea', id);
  idea.status_history = db
    .prepare('SELECT * FROM status_history WHERE idea_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(id);
  return idea;
}

export function createIdea(db, projectId, data) {
  const id = data.id || uid('idea_');
  const createdAt = now();
  let sectionId = data.section_id;
  if (!sectionId && data.section) {
    const section = getSectionByKey(db, projectId, data.section);
    if (!section) throw new Error(`Section not found: ${data.section}`);
    sectionId = section.id;
  }
  if (!sectionId) {
    const first = db.prepare('SELECT id FROM sections WHERE project_id = ? ORDER BY sort LIMIT 1').get(projectId);
    if (!first) throw new Error('Project has no sections');
    sectionId = first.id;
  }
  const status = STATUSES.includes(data.status) ? data.status : 'inbox';
  const kind = KINDS.includes(data.kind) ? data.kind : 'idea';
  const entityState = ENTITY_STATES.includes(data.entity_state) ? data.entity_state : 'n/a';
  const priority = PRIORITIES.includes(data.priority) ? data.priority : 'normal';

  db.prepare(
    `INSERT INTO ideas(id, project_id, section_id, parent_id, kind, title, body, status, entity_state, priority,
      author, source, tags_json, rejection_reason, resolution, proof, meta_json, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    projectId,
    sectionId,
    data.parent_id ?? null,
    kind,
    String(data.title || 'Без названия').trim(),
    data.body ?? '',
    status,
    entityState,
    priority,
    data.author ?? '',
    data.source ?? '',
    toJson(Array.isArray(data.tags) ? data.tags : []),
    data.rejection_reason ?? '',
    data.resolution ?? '',
    data.proof ?? '',
    toJson(data.meta ?? {}),
    createdAt,
    createdAt,
  );
  db.prepare(
    'INSERT INTO status_history(id, idea_id, from_status, to_status, comment, created_at) VALUES(?,?,?,?,?,?)',
  ).run(uid('sth_'), id, '', status, 'created', createdAt);
  logActivity(db, projectId, 'idea', id, 'created', data.title ?? '');
  return getIdea(db, id);
}

export function updateIdea(db, id, patch) {
  const current = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!current) return null;
  const nextStatus = patch.status ?? current.status;
  if (nextStatus !== 'rejected' && patch.rejection_reason === undefined) {
    patch = { ...patch, rejection_reason: '' };
  }
  const fields = [];
  const values = [];
  const allowed = [
    'section_id',
    'parent_id',
    'kind',
    'title',
    'body',
    'status',
    'entity_state',
    'priority',
    'author',
    'source',
    'rejection_reason',
    'resolution',
    'proof',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      let value = patch[key];
      if (key === 'kind' && !KINDS.includes(value)) value = 'idea';
      if (key === 'status' && !STATUSES.includes(value)) value = 'inbox';
      if (key === 'entity_state' && !ENTITY_STATES.includes(value)) value = 'n/a';
      if (key === 'priority' && !PRIORITIES.includes(value)) value = 'normal';
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (patch.tags !== undefined) {
    fields.push('tags_json = ?');
    values.push(toJson(Array.isArray(patch.tags) ? patch.tags : []));
  }
  if (patch.meta !== undefined) {
    fields.push('meta_json = ?');
    values.push(toJson(patch.meta ?? {}));
  }
  if (!fields.length) return getIdea(db, id);
  fields.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  if (patch.status !== undefined && patch.status !== current.status) {
    const comment = nextStatus === 'rejected'
      ? (patch.rejection_reason ?? current.rejection_reason ?? '')
      : nextStatus === 'implemented'
        ? (patch.resolution ?? current.resolution ?? '')
        : '';
    db.prepare(
      'INSERT INTO status_history(id, idea_id, from_status, to_status, comment, created_at) VALUES(?,?,?,?,?,?)',
    ).run(uid('sth_'), id, current.status, nextStatus, comment, now());
    logActivity(db, current.project_id, 'idea', id, 'status', `${current.status} → ${nextStatus}`);
  } else {
    logActivity(db, current.project_id, 'idea', id, 'updated', Object.keys(patch).join(', '));
  }
  return getIdea(db, id);
}

export function getAttachmentPaths(db, ideaId) {
  return db.prepare('SELECT stored_path FROM attachments WHERE idea_id = ?').all(ideaId).map((r) => r.stored_path);
}

export function deleteIdea(db, id) {
  const current = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!current) return false;
  const paths = getAttachmentPaths(db, id);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  logActivity(db, current.project_id, 'idea', id, 'deleted', current.title);
  return { ok: true, paths };
}

export function listAttachments(db, ideaId) {
  return db
    .prepare('SELECT * FROM attachments WHERE idea_id = ? ORDER BY created_at ASC')
    .all(ideaId)
    .map((row) => ({
      ...row,
      url: `/files/${String(row.stored_path).replaceAll('\\', '/')}`,
    }));
}

export function addAttachment(db, ideaId, attachment) {
  const id = attachment.id || uid('att_');
  db.prepare(
    `INSERT INTO attachments(id, idea_id, file_name, stored_path, mime, size, caption, created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    ideaId,
    attachment.file_name,
    attachment.stored_path,
    attachment.mime ?? 'application/octet-stream',
    Number(attachment.size ?? 0),
    attachment.caption ?? '',
    now(),
  );
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  return { ...row, url: `/files/${String(row.stored_path).replaceAll('\\', '/')}` };
}

export function deleteAttachment(db, id) {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  return row;
}

export function listLinks(db, ideaId) {
  const outgoing = db
    .prepare(
      `SELECT l.id, l.type, l.to_id AS idea_id, i.title, i.status, s.key AS section_key
       FROM links l JOIN ideas i ON i.id = l.to_id JOIN sections s ON s.id = i.section_id
       WHERE l.from_id = ?`,
    )
    .all(ideaId)
    .map((r) => ({ ...r, direction: 'out' }));
  const incoming = db
    .prepare(
      `SELECT l.id, l.type, l.from_id AS idea_id, i.title, i.status, s.key AS section_key
       FROM links l JOIN ideas i ON i.id = l.from_id JOIN sections s ON s.id = i.section_id
       WHERE l.to_id = ?`,
    )
    .all(ideaId)
    .map((r) => ({ ...r, direction: 'in' }));
  const seen = new Set();
  return [...outgoing, ...incoming].filter((link) => {
    const key = `${link.idea_id}:${link.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function addLink(db, fromId, toId, type = 'related') {
  if (fromId === toId) throw new Error('Cannot link an idea to itself');
  const id = uid('lnk_');
  db.prepare('INSERT OR IGNORE INTO links(id, from_id, to_id, type, created_at) VALUES(?,?,?,?,?)').run(
    id,
    fromId,
    toId,
    LINK_TYPES.includes(type) ? type : 'related',
    now(),
  );
  return db.prepare('SELECT * FROM links WHERE from_id = ? AND to_id = ? AND type = ?').get(
    fromId,
    toId,
    type,
  );
}

export function deleteLink(db, id) {
  const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
  if (!row) return false;
  db.prepare('DELETE FROM links WHERE id = ?').run(id);
  return true;
}

export function getStats(db, projectId) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM ideas WHERE project_id = ? GROUP BY status')
    .all(projectId)) {
    byStatus[row.status] = Number(row.n);
  }
  const bySection = db
    .prepare(
      `SELECT s.id, s.key, s.name, s.icon, s.color, COUNT(i.id) AS n
       FROM sections s LEFT JOIN ideas i ON i.section_id = s.id
       WHERE s.project_id = ? GROUP BY s.id ORDER BY s.sort`,
    )
    .all(projectId)
    .map((r) => ({ ...r, n: Number(r.n) }));
  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM ideas WHERE project_id = ?) AS ideas,
        (SELECT COUNT(*) FROM attachments a JOIN ideas i ON i.id = a.idea_id WHERE i.project_id = ?) AS attachments,
        (SELECT COUNT(*) FROM ideas WHERE project_id = ? AND status = 'clarify') AS clarify,
        (SELECT COUNT(*) FROM ideas WHERE project_id = ? AND status = 'inbox') AS inbox`,
    )
    .get(projectId, projectId, projectId, projectId);
  return {
    ideas: Number(totals.ideas ?? 0),
    attachments: Number(totals.attachments ?? 0),
    clarify: Number(totals.clarify ?? 0),
    inbox: Number(totals.inbox ?? 0),
    byStatus,
    bySection,
  };
}

export function getGraph(db, projectId) {
  const sections = listSections(db, projectId);
  const ideas = db
    .prepare(
      `SELECT i.id, i.title, i.status, i.kind, i.section_id, i.priority
       FROM ideas i WHERE i.project_id = ? ORDER BY i.created_at ASC`,
    )
    .all(projectId);
  const links = db
    .prepare(
      `SELECT l.id, l.from_id, l.to_id, l.type FROM links l
       JOIN ideas i ON i.id = l.from_id WHERE i.project_id = ?`,
    )
    .all(projectId);
  return { sections, ideas, links };
}

export function listAgentRuns(db, projectId, limit = 30) {
  return db
    .prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit)
    .map((row) => ({ ...row, sections: parseJson(row.sections_json, []) }));
}

export function createAgentRun(db, projectId, data) {
  const id = uid('run_');
  const at = now();
  db.prepare(
    `INSERT INTO agent_runs(id, project_id, sections_json, task, brief, status, result, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    projectId,
    toJson(data.sections ?? []),
    data.task ?? 'audit',
    data.brief ?? '',
    data.status ?? 'draft',
    data.result ?? '',
    at,
    at,
  );
  return listAgentRuns(db, projectId, 1)[0];
}

export function listActivity(db, projectId, limit = 50) {
  return db
    .prepare('SELECT * FROM activity WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit);
}
