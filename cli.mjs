#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { openApp } from './lib/app.mjs';
import * as db from './lib/db.mjs';
import { exportVault, buildSectionBrief } from './lib/export-vault.mjs';

const argv = process.argv.slice(2);
const command = argv.shift() || 'help';

function parseArgs(items) {
  const opts = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = items[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

const opts = parseArgs(argv);

function out(value) {
  if (typeof value === 'string') process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function need(name) {
  if (!opts[name]) {
    console.error(`Не хватает --${name}`);
    process.exit(1);
  }
  return opts[name];
}

function getProjectOrExit() {
  const project = db.getProject(database, need('project'));
  if (!project) {
    console.error(`Проект не найден: ${opts.project}`);
    process.exit(1);
  }
  return project;
}

function readBody() {
  if (opts.body) return String(opts.body);
  if (opts['body-file']) return readFileSync(String(opts['body-file']), 'utf8');
  if (opts.stdin && !process.stdin.isTTY) {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  }
  return '';
}

const database = openApp();

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    out(`Project OS CLI

Команды:
  projects
  sections --project <slug>
  list --project <slug> [--section <key>] [--status <status>] [--kind <kind>] [--tag <tag>] [--q <text>] [--limit 100]
  search --project <slug> --q <text>
  show --id <idea_id>
  add --project <slug> --section <key> --title "..." [--body "..."] [--body-file file] [--stdin] [--status inbox] [--kind idea] [--tags a,b] [--author user] [--source ...] [--parent id] [--priority high] [--entity-state new]
  update --id <idea_id> [--title "..."] [--body "..."] [--status accepted] [--rejection-reason "..."] [--tags a,b]
  brief --project <slug> [--section <key>] [--task audit|refine|expand|balance|art|narrative|tech] [--extra "..."] [--no-save]
  import --project <slug> [--vault <path>] [--dry-run]
  export --project <slug>
  stats --project <slug>

Пример:
  node cli.mjs list --project my-project --section events --status accepted
  node cli.mjs add --project my-project --section monsters --title "Новый враг" --body "..." --tags "враг,идея"`);
    process.exit(0);
  }

  if (command === 'projects') {
    out(db.listProjects(database).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      stage: p.stage,
      ideas: p.idea_count,
      sections: p.section_count,
      export_path: p.export_path,
    })));
    process.exit(0);
  }

  if (command === 'show') {
    const idea = db.getIdea(database, need('id'));
    if (!idea) {
      console.error('Идея не найдена');
      process.exit(1);
    }
    out(idea);
    process.exit(0);
  }

  const project = getProjectOrExit();

  if (command === 'sections') {
    out(db.listSections(database, project.id).map((s) => ({
      key: s.key,
      name: s.name,
      ideas: s.idea_count,
      inbox: s.inbox_count,
      clarify: s.clarify_count,
    })));
    process.exit(0);
  }

  if (command === 'list' || command === 'search') {
    const filters = {
      section: opts.section,
      status: opts.status,
      kind: opts.kind,
      tag: opts.tag,
      q: opts.q,
      author: opts.author,
      limit: opts.limit ? Number(opts.limit) : 200,
    };
    const ideas = db.listIdeas(database, project.id, filters);
    if (opts.json) {
      out(ideas);
    } else {
      for (const idea of ideas) {
        out(`[${idea.status}] ${idea.section_key} | ${idea.title} | ${idea.id}`);
      }
      out(`\nВсего: ${ideas.length}`);
    }
    process.exit(0);
  }

  if (command === 'add') {
    const section = opts.section || db.listSections(database, project.id)[0]?.key;
    if (!section) {
      console.error('В проекте нет разделов');
      process.exit(1);
    }
    const idea = db.createIdea(database, project.id, {
      section,
      title: need('title'),
      body: readBody(),
      status: opts.status || 'inbox',
      kind: opts.kind || 'idea',
      entity_state: opts['entity-state'] || 'n/a',
      priority: opts.priority || 'normal',
      author: opts.author || 'agent',
      source: opts.source || '',
      tags: opts.tags ? String(opts.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
      parent_id: opts.parent || null,
      rejection_reason: opts['rejection-reason'] || '',
    });
    out({ ok: true, id: idea.id, title: idea.title, section: idea.section_key, status: idea.status });
    process.exit(0);
  }

  if (command === 'update') {
    const idea = db.getIdea(database, need('id'));
    if (!idea) {
      console.error('Идея не найдена');
      process.exit(1);
    }
    const patch = {};
    for (const key of ['title', 'body', 'status', 'kind', 'priority', 'entity-state', 'author', 'source', 'rejection-reason']) {
      if (opts[key] !== undefined) {
        const target = key === 'entity-state' ? 'entity_state' : key === 'rejection-reason' ? 'rejection_reason' : key;
        patch[target] = opts[key];
      }
    }
    if (opts.tags) patch.tags = String(opts.tags).split(',').map((t) => t.trim()).filter(Boolean);
    const updated = db.updateIdea(database, idea.id, patch);
    out({ ok: true, id: updated.id, status: updated.status, title: updated.title });
    process.exit(0);
  }

  if (command === 'brief') {
    const sections = opts.section ? [opts.section] : db.listSections(database, project.id).map((s) => s.key);
    const brief = buildSectionBrief(database, project, sections, opts.task || 'audit', { extra: opts.extra });
    const save = opts['no-save'] !== true && opts['no-save'] !== 'true';
    if (save) {
      db.createAgentRun(database, project.id, { sections, task: opts.task || 'audit', brief });
    }
    out(brief);
    process.exit(0);
  }

  if (command === 'import') {
    const { importVault } = await import('./lib/import-vault.mjs');
    const result = importVault(database, project, {
      vaultPath: opts.vault,
      dryRun: opts['dry-run'] === true || opts['dry-run'] === 'true',
    });
    out(result);
    process.exit(0);
  }

  if (command === 'export') {
    const manifest = exportVault(database, project);
    out(manifest);
    process.exit(0);
  }

  if (command === 'stats') {
    out(db.getStats(database, project.id));
    process.exit(0);
  }

  console.error(`Неизвестная команда: ${command}. Используйте help.`);
  process.exit(1);
} finally {
  database.close();
}
