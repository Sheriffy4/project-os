import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openApp, DB_PATH, UPLOAD_DIR, ROOT } from './lib/app.mjs';
import * as db from './lib/db.mjs';
import { exportVault, buildSectionBrief } from './lib/export-vault.mjs';
import { importVault } from './lib/import-vault.mjs';
import { DEFAULT_SECTIONS, buildKickoffPrompt, buildStarterPrompts, starterIdeasFor } from './lib/templates.mjs';

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 60 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

const database = openApp();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

function queryFilters(url) {
  const filters = {};
  for (const key of ['section', 'status', 'kind', 'entity_state', 'author', 'tag', 'q', 'parent']) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  const limit = url.searchParams.get('limit');
  if (limit) filters.limit = Number(limit);
  return filters;
}

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'file';
}

function saveAttachment(ideaId, payload) {
  if (!payload || !payload.data) return null;
  const buffer = Buffer.from(String(payload.data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) return null;
  if (buffer.length > MAX_FILE) throw new HttpError(413, `Файл больше ${Math.round(MAX_FILE / 1024 / 1024)} МБ`);
  const fileName = safeFileName(payload.name);
  const dir = join(UPLOAD_DIR, ideaId);
  mkdirSync(dir, { recursive: true });
  const storedName = `${randomUUID().slice(0, 12)}_${fileName}`;
  const absolute = join(dir, storedName);
  writeFileSync(absolute, buffer);
  return {
    file_name: fileName,
    stored_path: `${ideaId}/${storedName}`,
    mime: payload.mime || 'application/octet-stream',
    size: buffer.length,
    caption: payload.caption || '',
  };
}

function cleanupFileIfUnused(storedPath) {
  if (!storedPath) return;
  const refs = database.prepare('SELECT COUNT(*) AS n FROM attachments WHERE stored_path = ?').get(storedPath);
  if (Number(refs?.n || 0) > 0) return;
  const absolute = resolve(UPLOAD_DIR, storedPath);
  if (!absolute.startsWith(resolve(UPLOAD_DIR) + sep)) return;
  try {
    if (existsSync(absolute)) unlinkSync(absolute);
  } catch {
    // ignore
  }
}

function serveFile(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    json(res, 404, { error: 'Файл не найден' });
    return;
  }
  const st = statSync(filePath);
  if (!st.isFile()) {
    json(res, 404, { error: 'Файл не найден' });
    return;
  }
  const noStore = /\.(html|js|css)$/i.test(filePath);
  res.writeHead(200, {
    'Content-Type': contentType || MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': noStore ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(res);
}

async function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '') {
    serveFile(res, join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
    return true;
  }
  if (pathname.startsWith('/files/')) {
    const relativePath = decodeURIComponent(pathname.slice('/files/'.length));
    const absolute = resolve(UPLOAD_DIR, relativePath);
    if (!absolute.startsWith(resolve(UPLOAD_DIR) + sep)) {
      json(res, 403, { error: 'Запрещено' });
      return true;
    }
    serveFile(res, absolute);
    return true;
  }
  const candidate = resolve(PUBLIC_DIR, `.${pathname}`);
  if (candidate.startsWith(resolve(PUBLIC_DIR) + sep) && existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return true;
  }
  // SPA fallback
  serveFile(res, join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  return true;
}

function projectOr404(id) {
  const project = db.getProject(database, id);
  if (!project) throw new HttpError(404, 'Проект не найден');
  return project;
}

function ideaOr404(id) {
  const idea = db.getIdea(database, id);
  if (!idea) throw new HttpError(404, 'Идея не найдена');
  return idea;
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method || 'GET';

  if (p === '/api/health') {
    return json(res, 200, {
      ok: true,
      version: '0.2.0',
      db: DB_PATH,
      projects: db.listProjects(database).length,
      time: new Date().toISOString(),
    });
  }

  if (p === '/api/meta') {
    return json(res, 200, {
      statuses: db.STATUSES,
      entityStates: db.ENTITY_STATES,
      kinds: db.KINDS,
      priorities: db.PRIORITIES,
      linkTypes: db.LINK_TYPES,
      defaultSections: DEFAULT_SECTIONS,
    });
  }

  if (p === '/api/projects' && method === 'GET') {
    return json(res, 200, { projects: db.listProjects(database) });
  }

  if (p === '/api/projects' && method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !String(body.name).trim()) throw new HttpError(400, 'Нужно название проекта');
    const meta = {
      genre: body.genre || '',
      platforms: body.platforms || [],
      references: body.references || [],
      pillars: body.pillars || [],
      audience: body.audience || '',
      createdBy: 'wizard',
    };
    const sections = Array.isArray(body.sections) && body.sections.length ? body.sections : DEFAULT_SECTIONS;
    const project = db.createProject(database, {
      name: String(body.name).trim(),
      slug: body.slug || undefined,
      description: body.description || '',
      stage: body.stage || 'concept',
      export_path: body.export_path || '',
      meta,
      sections,
    });
    const kickoffPrompt = buildKickoffPrompt(project);
    const exportPath = body.export_path || `projects/${project.slug}/vault`;
    db.updateProject(database, project.id, { export_path: exportPath, meta: { ...meta, kickoffPrompt } });
    project.export_path = exportPath;
    if (body.starter !== false) {
      for (const idea of starterIdeasFor(project)) {
        db.createIdea(database, project.id, idea);
      }
    }

    let vault = null;
    try {
      vault = exportVault(database, db.getProject(database, project.id));
    } catch (error) {
      console.warn(`[kb] project vault export failed: ${error.message}`);
    }

    return json(res, 201, {
      project: db.getProject(database, project.id),
      kickoffPrompt,
      starterPrompts: buildStarterPrompts(project),
      vault,
    });
  }

  let m = p.match(/^\/api\/projects\/([^/]+)$/);
  if (m && method === 'GET') return json(res, 200, { project: projectOr404(decodeURIComponent(m[1])) });

  if (m && method === 'PATCH') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    return json(res, 200, { project: db.updateProject(database, project.id, body) });
  }

  if (m && method === 'DELETE') {
    const project = projectOr404(decodeURIComponent(m[1]));
    if (url.searchParams.get('confirm') !== '1') throw new HttpError(400, 'Нужно подтверждение: ?confirm=1');
    const uploadDirs = new Set([project.id]);
    for (const row of database
      .prepare(
        `SELECT DISTINCT a.stored_path
         FROM attachments a JOIN ideas i ON i.id = a.idea_id
         WHERE i.project_id = ?`,
      )
      .all(project.id)) {
      const topLevel = String(row.stored_path || '').split(/[\\/]/)[0];
      if (topLevel) uploadDirs.add(topLevel);
    }
    database.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    for (const dirName of uploadDirs) {
      const uploadDir = resolve(UPLOAD_DIR, dirName);
      if (uploadDir.startsWith(resolve(UPLOAD_DIR) + sep) && existsSync(uploadDir)) {
        rmSync(uploadDir, { recursive: true, force: true });
      }
    }
    return json(res, 200, { ok: true });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/sections$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, { sections: db.listSections(database, project.id) });
  }
  if (m && method === 'POST') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    return json(res, 201, { section: db.createSection(database, project.id, body) });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/ideas$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, { ideas: db.listIdeas(database, project.id, queryFilters(url)) });
  }
  if (m && method === 'POST') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    if (!body.title || !String(body.title).trim()) throw new HttpError(400, 'Нужен заголовок');
    if (body.status === 'rejected' && !body.rejection_reason) throw new HttpError(400, 'Для отказа нужна причина');
    const idea = db.createIdea(database, project.id, { ...body, parent_id: body.parent_id || null });
    const errors = [];
    for (const file of body.attachments || []) {
      try {
        const saved = saveAttachment(idea.id, file);
        if (saved) db.addAttachment(database, idea.id, saved);
      } catch (error) {
        errors.push({ file: file.name, error: error.message });
      }
    }
    return json(res, 201, { idea: db.getIdea(database, idea.id), errors });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/graph$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, db.getGraph(database, project.id));
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/stats$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, db.getStats(database, project.id));
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/activity$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, { activity: db.listActivity(database, project.id) });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/brief$/);
  if (m && method === 'POST') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    const sections = Array.isArray(body.sections) && body.sections.length
      ? body.sections
      : body.section
        ? [body.section]
        : db.listSections(database, project.id).map((s) => s.key);
    const brief = buildSectionBrief(database, project, sections, body.task || 'audit', { extra: body.extra });
    let run = null;
    if (body.save !== false) {
      run = db.createAgentRun(database, project.id, {
        sections,
        task: body.task || 'audit',
        brief,
        status: 'draft',
      });
    }
    return json(res, 200, { brief, run });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/agent-runs$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    return json(res, 200, { runs: db.listAgentRuns(database, project.id) });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/import$/);
  if (m && method === 'POST') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    const result = importVault(database, project, { vaultPath: body.vaultPath, dryRun: Boolean(body.dryRun) });
    return json(res, 200, { ok: true, result });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (m && method === 'POST') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const manifest = exportVault(database, project);
    return json(res, 200, { ok: true, manifest });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/download$/);
  if (m && method === 'GET') {
    const project = projectOr404(decodeURIComponent(m[1]));
    const ideas = db.listIdeas(database, project.id, { limit: 5000 }).map((idea) => ({
      ...idea,
      attachments: db.listAttachments(database, idea.id),
    }));
    const payload = JSON.stringify({ project, ideas, generated_at: new Date().toISOString() }, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${project.slug}-kb.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(payload);
    return;
  }

  m = p.match(/^\/api\/ideas\/([^/]+)$/);
  if (m && method === 'GET') return json(res, 200, { idea: ideaOr404(decodeURIComponent(m[1])) });
  if (m && method === 'PATCH') {
    const idea = ideaOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    const nextStatus = body.status ?? idea.status;
    const nextReason = body.rejection_reason ?? idea.rejection_reason;
    if (nextStatus === 'rejected' && !String(nextReason || '').trim()) {
      throw new HttpError(400, 'Для отказа нужна причина');
    }
    return json(res, 200, { idea: db.updateIdea(database, idea.id, body) });
  }
  if (m && method === 'DELETE') {
    const idea = ideaOr404(decodeURIComponent(m[1]));
    const result = db.deleteIdea(database, idea.id);
    for (const path of result.paths || []) cleanupFileIfUnused(path);
    return json(res, 200, { ok: true });
  }

  m = p.match(/^\/api\/ideas\/([^/]+)\/attachments$/);
  if (m && method === 'POST') {
    const idea = ideaOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    const files = Array.isArray(body.attachments) ? body.attachments : [body];
    const added = [];
    const errors = [];
    for (const file of files) {
      try {
        const saved = saveAttachment(idea.id, file);
        if (saved) added.push(db.addAttachment(database, idea.id, saved));
      } catch (error) {
        errors.push({ file: file.name, error: error.message });
      }
    }
    return json(res, 201, { attachments: added, errors, idea: db.getIdea(database, idea.id) });
  }

  m = p.match(/^\/api\/attachments\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const row = db.deleteAttachment(database, decodeURIComponent(m[1]));
    if (!row) throw new HttpError(404, 'Вложение не найдено');
    cleanupFileIfUnused(row.stored_path);
    return json(res, 200, { ok: true });
  }

  m = p.match(/^\/api\/ideas\/([^/]+)\/links$/);
  if (m && method === 'POST') {
    const idea = ideaOr404(decodeURIComponent(m[1]));
    const body = await readBody(req);
    if (!body.to_id) throw new HttpError(400, 'Нужен to_id');
    const target = ideaOr404(body.to_id);
    if (target.project_id !== idea.project_id) throw new HttpError(400, 'Нельзя связывать идеи разных проектов');
    const link = db.addLink(database, idea.id, target.id, body.type || 'related');
    return json(res, 201, { link });
  }

  m = p.match(/^\/api\/links\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const ok = db.deleteLink(database, decodeURIComponent(m[1]));
    if (!ok) throw new HttpError(404, 'Связь не найдена');
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, 'API: маршрут не найден');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(res, decodeURIComponent(url.pathname));
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) json(res, status, { error: error.message || 'Внутренняя ошибка' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  PROJECT OS — база знаний проекта');
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  SQLite: ${DB_PATH}`);
  console.log(`  Vault:  ${db.listProjects(database).map((p) => `${p.slug} -> ${p.export_path}`).join(', ')}`);
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} занят. Запустите с PORT=другой_порт.`);
    process.exit(1);
  }
  throw error;
});

process.on('SIGINT', () => {
  console.log('\n[kb] остановка');
  database.close();
  process.exit(0);
});
