import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import {
  ENTITY_STATES,
  KINDS,
  LINK_TYPES,
  PRIORITIES,
  STATUSES,
  addAttachment,
  addLink,
  createIdea,
  getIdea,
  getProject,
  listAttachments,
  listIdeas,
  listLinks,
  listSections,
  updateIdea,
} from './db.mjs';
import { APP_ROOT, UPLOAD_DIR } from './paths.mjs';

const SKIP_DIRS = new Set(['_assets', '_briefs', '_meta', '_sources', '.obsidian', '.git', 'node_modules']);
const SKIP_FILES = new Set(['_index.md', '00_INDEX.md', 'AGENTS.md', 'README.md']);
const ATTACHMENT_SECTION = 'Вложения';
const LINK_SECTION = 'Связи';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value === '[]') return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

export function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: normalized };
  const yaml = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const data = {};
  let listKey = null;
  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      if (listKey) {
        if (!Array.isArray(data[listKey])) data[listKey] = [];
        data[listKey].push(parseScalar(item[1]));
      }
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      const key = pair[1];
      const raw = pair[2];
      listKey = raw === '' ? key : null;
      data[key] = parseScalar(raw);
    }
  }
  return { data, body };
}

function walkMarkdown(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolute = join(dir, entry);
    const st = statSync(absolute);
    if (st.isDirectory()) {
      walkMarkdown(absolute, base, out);
      continue;
    }
    if (!entry.toLowerCase().endsWith('.md')) continue;
    if (SKIP_FILES.has(entry)) continue;
    out.push({ absolute, relative: relative(base, absolute).replaceAll('\\', '/') });
  }
  return out;
}

function sectionKeyFromPath(relativePath) {
  const first = relativePath.split('/')[0] || '';
  const match = first.match(/^\d{2}_([a-z0-9-]+)$/i);
  return match ? match[1] : '';
}

function firstHeading(body) {
  const line = String(body || '').split('\n').find((item) => /^#+\s+/.test(item));
  return line ? line.replace(/^#+\s+/, '').trim() : '';
}

function withoutTitleHeading(body, title) {
  let text = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const marked = text.match(/<!--\s*body:start\s*-->([\s\S]*?)<!--\s*body:end\s*-->/i);
  if (marked) return marked[1].trim();

  const lines = text.split('\n');
  if (lines[0] && /^#\s+/.test(lines[0]) && lines[0].replace(/^#\s+/, '').trim() === String(title || '').trim()) {
    text = lines.slice(1).join('\n').trim();
  }
  text = text
    .split('\n')
    .filter((line) => !/^>\s*\*\*Статус:\*\*/.test(line))
    .join('\n')
    .trim();
  text = text.replace(/\n##\s+(Вложения|Связи|Комментарии)\s*\n[\s\S]*?(?=\n##\s+|$)/gu, '').trim();
  return text;
}

function sectionBody(body, heading) {
  const re = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'u');
  const match = String(body || '').match(re);
  return match ? match[1] : '';
}

function parseWikilinks(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\s*-\s*!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\](?:\s*\(([^)]+)\))?/u);
    if (!match) continue;
    out.push({
      path: match[1].trim(),
      label: (match[2] || '').trim(),
      type: (match[3] || '').trim(),
    });
  }
  return out;
}

function safeFileName(name) {
  const base = basename(String(name || '').replaceAll('\\', '/'));
  return (
    (base
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'file').slice(0, 120)
  );
}

function attachmentName(relPath, label) {
  const pathName = basename(String(relPath || '').replaceAll('\\', '/'));
  const withoutExportPrefix = pathName.replace(/^[0-9a-f]{8}_/i, '');
  const candidate = label && label !== relPath ? label : withoutExportPrefix;
  return safeFileName(candidate);
}

function resolveAsset(base, relPath) {
  const clean = String(relPath || '').replaceAll('\\', '/').replace(/^\.\/+/, '').trim();
  if (!clean) return null;
  const root = resolve(base);
  const absolute = resolve(root, clean);
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  return absolute;
}

function mimeFor(name) {
  return MIME[extname(String(name || '')).toLowerCase()] || 'application/octet-stream';
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function sameArray(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

export function importVault(db, project, options = {}) {
  const base = resolve(APP_ROOT, options.vaultPath || project.export_path || `projects/${project.slug}/vault`);
  if (!existsSync(base)) throw new Error(`Vault не найден: ${base}`);
  const sections = listSections(db, project.id);
  if (!sections.length) throw new Error('В проекте нет разделов');
  const sectionByKey = new Map(sections.map((section) => [section.key, section]));
  const files = walkMarkdown(base);
  const dryRun = Boolean(options.dryRun);
  const summary = {
    vault: base,
    scanned: files.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    attachments_added: 0,
    links_added: 0,
    errors: [],
  };

  const records = [];

  for (const file of files) {
    try {
      const raw = readFileSync(file.absolute, 'utf8');
      const { data, body } = parseFrontmatter(raw);
      const sectionKey = String(data.section || sectionKeyFromPath(file.relative) || '');
      const section = sectionByKey.get(sectionKey) || sections[0];
      const title = String(data.title || firstHeading(body) || file.relative.replace(/\.md$/i, '')).trim();
      if (!title) {
        summary.skipped += 1;
        continue;
      }
      const cleanBody = withoutTitleHeading(body, title);
      const existing = data.id ? getIdea(db, String(data.id)) : null;
      const status = STATUSES.includes(data.status) ? data.status : 'inbox';
      const kind = KINDS.includes(data.kind) ? data.kind : 'idea';
      const entityState = ENTITY_STATES.includes(data.entity_state) ? data.entity_state : 'n/a';
      const priority = PRIORITIES.includes(data.priority) ? data.priority : 'normal';
      const tags = asArray(data.tags);
      const rejectionReason = data.rejection_reason ? String(data.rejection_reason) : '';
      let idea = existing && existing.project_id === project.id ? existing : null;

      if (idea) {
        const patch = {};
        if (idea.title !== title) patch.title = title;
        if (String(idea.body || '').trim() !== cleanBody) patch.body = cleanBody;
        if (idea.section_id !== section.id) patch.section_id = section.id;
        if (idea.status !== status) patch.status = status;
        if (idea.kind !== kind) patch.kind = kind;
        if (idea.entity_state !== entityState) patch.entity_state = entityState;
        if (idea.priority !== priority) patch.priority = priority;
        if ((idea.author || '') !== String(data.author || idea.author || '')) patch.author = data.author || idea.author || '';
        if ((idea.source || '') !== String(data.source || idea.source || '')) patch.source = data.source || idea.source || '';
        if (!sameArray(idea.tags, tags)) patch.tags = tags;
        if ((idea.rejection_reason || '') !== rejectionReason) patch.rejection_reason = rejectionReason;
        if (patch.status === 'rejected' && !String(patch.rejection_reason || idea.rejection_reason || '').trim()) {
          patch.rejection_reason = 'Причина не указана в vault';
        }
        if (Object.keys(patch).length) {
          if (!dryRun) idea = updateIdea(db, idea.id, patch);
          summary.updated += 1;
        } else {
          summary.unchanged += 1;
        }
      } else {
        summary.created += 1;
        if (!dryRun) {
          idea = createIdea(db, project.id, {
            section: section.key,
            title,
            body: cleanBody,
            status,
            kind,
            entity_state: entityState,
            priority,
            author: data.author || 'obsidian',
            source: data.source || 'vault-import',
            tags,
            rejection_reason: status === 'rejected' ? rejectionReason || 'Причина не указана в vault' : '',
          });
        }
      }

      records.push({ file, data, rawBody: body, cleanBody, idea, title });
    } catch (error) {
      summary.errors.push({ file: file.relative, error: error.message });
    }
  }

  // Build lookup maps after the first pass so links can point at notes
  // that were created during this same import.
  const allIdeas = listIdeas(db, project.id, { limit: 5000 });
  const byId = new Map(allIdeas.map((idea) => [idea.id, idea]));
  const byTitle = new Map(allIdeas.map((idea) => [idea.title, idea]));
  const byPath = new Map();
  const byFile = new Map();

  for (const record of records) {
    const noExt = record.file.relative.replace(/\.md$/i, '');
    byPath.set(noExt, record);
    byPath.set(noExt.split('/').pop(), record);
    byFile.set(basename(record.file.relative, extname(record.file.relative)), record);
    byTitle.set(record.title, record);
    if (record.idea) {
      byId.set(record.idea.id, record.idea);
      byTitle.set(record.idea.title, record.idea);
    }
  }

  for (const record of records) {
    const sourceIdea = record.idea;
    const sourceId = sourceIdea?.id;
    const existingAttachments = sourceIdea ? listAttachments(db, sourceIdea.id) : [];
    const existingLinks = sourceIdea ? listLinks(db, sourceIdea.id) : [];
    const linkKeys = new Set(existingLinks.map((link) => `${link.idea_id}:${link.type}`));

    const attachmentCandidates = new Map();
    for (const path of asArray(record.data.attachments)) {
      const name = attachmentName(path, '');
      attachmentCandidates.set(name.toLowerCase(), { path, name });
    }
    for (const link of parseWikilinks(sectionBody(record.rawBody, ATTACHMENT_SECTION))) {
      const name = attachmentName(link.path, link.label);
      attachmentCandidates.set(name.toLowerCase(), { path: link.path, name });
    }

    for (const { path, name } of attachmentCandidates.values()) {
      if (existingAttachments.some((attachment) => attachment.file_name.toLowerCase() === name.toLowerCase())) {
        continue;
      }
      const absolute = resolveAsset(base, path);
      if (!absolute || !existsSync(absolute) || !statSync(absolute).isFile()) {
        summary.errors.push({ file: record.file.relative, error: `Вложение не найдено: ${path}` });
        continue;
      }
      if (dryRun || !sourceId) {
        summary.attachments_added += 1;
        continue;
      }
      const storedName = `${randomUUID()}_${name}`;
      const destDir = join(UPLOAD_DIR, project.id);
      mkdirSync(destDir, { recursive: true });
      const destination = join(destDir, storedName);
      copyFileSync(absolute, destination);
      addAttachment(db, sourceId, {
        file_name: name,
        stored_path: `${project.id}/${storedName}`.replaceAll('\\', '/'),
        mime: mimeFor(name),
        size: statSync(destination).size,
      });
      summary.attachments_added += 1;
    }

    for (const link of parseWikilinks(sectionBody(record.rawBody, LINK_SECTION))) {
      const targetPath = link.path.replace(/\.md$/i, '');
      const target =
        byPath.get(targetPath) ||
        byFile.get(basename(targetPath)) ||
        byId.get(link.path) ||
        byTitle.get(link.label);
      if (!target) continue;
      const targetId = target.idea?.id || (target.id ? target.id : null);
      if (!targetId || targetId === sourceId) continue;
      const type = LINK_TYPES.includes(link.type) ? link.type : 'related';
      const key = `${targetId}:${type}`;
      if (linkKeys.has(key)) continue;
      if (!dryRun && sourceId) addLink(db, sourceId, targetId, type);
      linkKeys.add(key);
      summary.links_added += 1;
    }
  }

  return summary;
}

export function importProjectBySlug(db, slug, options = {}) {
  const project = getProject(db, slug);
  if (!project) throw new Error(`Проект не найден: ${slug}`);
  return importVault(db, project, options);
}
