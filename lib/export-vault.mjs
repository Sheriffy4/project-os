import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listSections, listIdeas, listAttachments, getStats, setSetting, now } from './db.mjs';
import { APP_ROOT, UPLOAD_DIR } from './paths.mjs';
import { buildFileTemplate } from './project-files.mjs';

export const ROOT = APP_ROOT;

function safeWrite(file, data) {
  try {
    writeFileSync(file, data, 'utf8');
  } catch (error) {
    console.warn(`[export] cannot write ${file}: ${error.message}`);
  }
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(text, fallback = 'note') {
  const transliterated = String(text)
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || fallback;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function safeName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function sectionDir(section) {
  return `${String(section.sort + 1).padStart(2, '0')}_${section.key}`;
}

function ideaFileName(section, idea, index) {
  const num = String(index + 1).padStart(3, '0');
  return `${num}_${slugify(idea.title, idea.id)}.md`;
}

function wikilink(fileBase, title) {
  return `[[${fileBase}|${String(title).replaceAll('|', '-')}]]`;
}

function attachmentMarkdown(att, relPath) {
  const isImage = String(att.mime || '').startsWith('image/');
  return isImage ? `![[${relPath}]]` : `[[${relPath}|${att.file_name}]]`;
}

export function buildSectionBrief(db, project, sectionKeys, task = 'audit', options = {}) {
  const sections = listSections(db, project.id).filter((s) => !sectionKeys?.length || sectionKeys.includes(s.key));
  const all = listIdeas(db, project.id, { limit: 5000 });
  const relevant = all.filter((i) => sections.some((s) => s.id === i.section_id));
  const byStatus = (statuses) => relevant.filter((i) => statuses.includes(i.status));
  const accepted = byStatus(['accepted', 'implemented']);
  const rework = byStatus(['needs_rework']);
  const clarify = byStatus(['clarify']);
  const rejected = byStatus(['rejected']);
  const future = byStatus(['future']);
  const inbox = byStatus(['inbox']);

  const taskLabels = {
    audit: 'аудит раздела: найти противоречия, дыры и слабые места, не переписывая принятые решения',
    refine: 'доработка: превратить сырые идеи в конкретные игровые механики, цифры и тексты',
    expand: 'расширение: предложить новые идеи, которые усиливают принятые решения',
    balance: 'баланс: проверить числа, синергии, винрейт и потенциальные поломки',
    art: 'арт-аудит: проверить визуальный стиль, пайплайн, консистентность и референсы',
    narrative: 'нарратив: проверить мета-сюжет, юмор, реплики и слом четвёртой стены',
    tech: 'технический аудит: архитектура, движок, данные, производительность, риски',
  };

  const sectionNames = sections.map((s) => `${s.icon} ${s.name}`).join(', ');
  const compact = options.compact ?? sections.length > 3;
  const cut = (text, full, short) => excerpt(text, compact ? short : full);
  const lines = [];
  lines.push(`# Бриф агента: ${sectionNames}`);
  lines.push('');
  lines.push(`**Проект:** ${project.name} (${project.slug})`);
  lines.push(`**Стадия:** ${project.stage}`);
  lines.push(`**Задача:** ${taskLabels[task] || task}`);
  lines.push(`**Дата:** ${new Date().toISOString().slice(0, 10)}`);
  if (compact) {
    lines.push('');
    lines.push(`> Режим: обзорный (${sections.length} разделов). Полные брифы по каждому разделу — в папке _briefs/<key>.md.`);
  }
  lines.push('');
  lines.push('## Контекст проекта');
  lines.push(project.description || '—');
  lines.push('');
  lines.push('## Жёсткие правила');
  lines.push('1. Не противоречь принятым решениям. Если считаешь решение ошибочным — предложи изменение отдельным пунктом с обоснованием.');
  lines.push('2. Не выдумывай факты, ссылки и цифры. Если данных нет — пиши «нужно уточнить».');
  lines.push('3. Не тащи в текущую версию то, что помечено как «Будущее» или «Отклонено».');
  lines.push('4. Каждое предложение должно быть атомарным: заголовок, суть, эффект на игру, риски, статус.');
  lines.push('5. Юмор — часть механики, а не украшение. Но читаемость важнее шутки.');
  lines.push('6. Не использовать чужие названия, логотипы, узнаваемые дизайны и оригинальные цитаты.');
  lines.push('');
  lines.push('## Принятые решения (не менять без причины)');
  for (const idea of accepted) {
    lines.push(`- **${idea.title}** [${idea.section_name}] — ${cut(idea.body, 700, 260)}`);
  }
  if (!accepted.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Требует доработки');
  for (const idea of rework) {
    lines.push(`- **${idea.title}** — ${cut(idea.body, 900, 360)}`);
  }
  if (!rework.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Нужно уточнить');
  for (const idea of clarify) {
    lines.push(`- **${idea.title}** — ${cut(idea.body, 900, 360)}`);
  }
  if (!clarify.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Отклонено (не предлагать в текущую версию)');
  for (const idea of rejected) {
    lines.push(`- **${idea.title}** — причина: ${idea.rejection_reason || cut(idea.body, 400, 200)}`);
  }
  if (!rejected.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Будущее / DLC / спин-оффы (не тащить в базу 1.0)');
  for (const idea of future) {
    lines.push(`- **${idea.title}** — ${cut(idea.body, 600, 240)}`);
  }
  if (!future.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Входящие предложения (ещё не утверждены)');
  for (const idea of inbox) {
    lines.push(`- **${idea.title}** — ${cut(idea.body, 600, 240)}`);
  }
  if (!inbox.length) lines.push('- Нет.');
  lines.push('');
  lines.push('## Формат ответа');
  lines.push('Верни markdown-отчёт по разделам:');
  lines.push('1. **Что работает** — коротко.');
  lines.push('2. **Противоречия и дыры** — с указанием, какие записи конфликтуют.');
  lines.push('3. **Предложения** — каждое с заголовком, сутью, эффектом, риском и рекомендуемым статусом (inbox / accepted / needs_rework / clarify / future / rejected).');
  lines.push('4. **Новые вопросы** — только те, без которых нельзя двигаться дальше.');
  lines.push('5. **Следующий шаг** — одно конкретное действие.');
  lines.push('');
  if (options.extra) {
    lines.push('## Дополнительное задание');
    lines.push(options.extra);
    lines.push('');
  }
  return lines.join('\n');
}

function excerpt(text, max = 500) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function exportVault(db, project, options = {}) {
  if (!project) throw new Error('Project not found');
  const base = project.export_path
    ? resolve(ROOT, project.export_path)
    : resolve(ROOT, 'exports', project.slug);
  if (base === ROOT || base === resolve(ROOT, '..')) {
    throw new Error('Нельзя экспортировать vault в корень приложения');
  }
  mkdirSync(base, { recursive: true });
  // Clean only generated parts. Keep .obsidian and any user-created notes outside
  // the numbered sections. On Windows Obsidian can hold a directory handle;
  // a failed cleanup must not abort the whole export.
  for (const entry of readdirSync(base)) {
    if (entry.startsWith('.')) continue;
    if (
      entry === '00_INDEX.md' ||
      entry === '_assets' ||
      entry === '_briefs' ||
      entry === '_meta' ||
      /^\d{2}_/.test(entry)
    ) {
      try {
        rmSync(join(base, entry), { recursive: true, force: true });
      } catch (error) {
        console.warn(`[export] cannot clean ${entry}: ${error.message}`);
      }
    }
  }
  mkdirSync(base, { recursive: true });
  mkdirSync(join(base, '_assets'), { recursive: true });
  mkdirSync(join(base, '_briefs'), { recursive: true });

  const sections = listSections(db, project.id);
  const ideas = listIdeas(db, project.id, { limit: 5000 });
  const links = db
    .prepare(
      `SELECT l.*, i.title AS from_title, t.title AS to_title
       FROM links l JOIN ideas i ON i.id = l.from_id JOIN ideas t ON t.id = l.to_id
       WHERE i.project_id = ?`,
    )
    .all(project.id);
  const stats = getStats(db, project.id);

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const fileById = new Map();
  const bySection = new Map();
  for (const idea of ideas) {
    if (!bySection.has(idea.section_id)) bySection.set(idea.section_id, []);
    bySection.get(idea.section_id).push(idea);
  }
  for (const section of sections) {
    const list = (bySection.get(section.id) || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    list.forEach((idea, index) => {
      fileById.set(idea.id, `${sectionDir(section)}/${ideaFileName(section, idea, index).replace(/\.md$/, '')}`);
    });
  }

  const attachmentPathById = new Map();
  for (const idea of ideas) {
    const attachments = listAttachments(db, idea.id);
    for (const att of attachments) {
      if (attachmentPathById.has(att.id)) continue;
      const sourcePath = resolve(UPLOAD_DIR, att.stored_path);
      if (!existsSync(sourcePath)) continue;
      const fileName = `${att.id.slice(-8)}_${safeName(att.file_name)}`;
      const dest = join(base, '_assets', fileName);
      try {
        if (!existsSync(dest)) copyFileSync(sourcePath, dest);
        attachmentPathById.set(att.id, `_assets/${fileName}`);
      } catch (error) {
        console.warn(`[export] cannot copy attachment ${att.file_name}: ${error.message}`);
      }
    }
  }

  for (const section of sections) {
    const dir = join(base, sectionDir(section));
    mkdirSync(dir, { recursive: true });
    const list = (bySection.get(section.id) || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const index = [];
    index.push('---');
    index.push(`section: ${yamlString(section.key)}`);
    index.push(`name: ${yamlString(section.name)}`);
    index.push(`project: ${yamlString(project.slug)}`);
    index.push(`generated: ${yamlString(now())}`);
    index.push('---');
    index.push('');
    index.push(`# ${section.icon} ${section.name}`);
    index.push('');
    index.push(section.description || '');
    index.push('');
    index.push(`Всего записей: **${list.length}**.`);
    index.push('');
    for (const idea of list) {
      const fileBase = fileById.get(idea.id);
      const fileName = fileBase.split('/').pop();
      index.push(`- ${wikilink(fileName, idea.title)} — \`${idea.status}\`${idea.tags.length ? ` · ${idea.tags.join(', ')}` : ''}`);
    }
    safeWrite(join(dir, '_index.md'), index.join('\n'));

    for (const idea of list) {
      const fileBase = fileById.get(idea.id);
      const parts = fileBase.split('/');
      const fileName = parts.pop();
      const filePath = join(base, ...parts, `${fileName}.md`);
      const attachments = listAttachments(db, idea.id);
      const seenLinks = new Set();
      const ideaLinks = links
        .filter((l) => l.from_id === idea.id || l.to_id === idea.id)
        .filter((l) => {
          const otherId = l.from_id === idea.id ? l.to_id : l.from_id;
          const key = `${otherId}:${l.type}`;
          if (seenLinks.has(key)) return false;
          seenLinks.add(key);
          return true;
        });
      const children = ideas.filter((i) => i.parent_id === idea.id);

      const fm = [];
      fm.push('---');
      fm.push(`id: ${yamlString(idea.id)}`);
      fm.push(`title: ${yamlString(idea.title)}`);
      fm.push(`section: ${yamlString(idea.section_key)}`);
      fm.push(`section_name: ${yamlString(idea.section_name)}`);
      fm.push(`status: ${yamlString(idea.status)}`);
      fm.push(`kind: ${yamlString(idea.kind)}`);
      fm.push(`entity_state: ${yamlString(idea.entity_state)}`);
      fm.push(`priority: ${yamlString(idea.priority)}`);
      fm.push(`author: ${yamlString(idea.author)}`);
      fm.push(`source: ${yamlString(idea.source)}`);
      fm.push('tags:');
      for (const tag of idea.tags) fm.push(`  - ${yamlString(tag)}`);
      if (!idea.tags.length) fm.push('  []');
      fm.push(`created: ${yamlString(idea.created_at)}`);
      fm.push(`updated: ${yamlString(idea.updated_at)}`);
      if (idea.rejection_reason) fm.push(`rejection_reason: ${yamlString(idea.rejection_reason)}`);
      if (idea.resolution) fm.push(`resolution: ${yamlString(idea.resolution)}`);
      if (idea.proof) fm.push(`proof: ${yamlString(idea.proof)}`);
      if (attachments.length) {
        fm.push('attachments:');
        for (const att of attachments) {
          const rel = attachmentPathById.get(att.id);
          if (rel) fm.push(`  - ${yamlString(rel)}`);
        }
      }
      fm.push('---');
      fm.push('');
      fm.push(`# ${idea.title}`);
      fm.push('');
      fm.push(`> **Статус:** ${idea.status} · **Тип:** ${idea.kind} · **Раздел:** ${idea.section_name}${idea.entity_state !== 'n/a' ? ` · **Объект:** ${idea.entity_state}` : ''}`);
      fm.push('');
      fm.push('<!-- body:start -->');
      fm.push(idea.body || '_Описание пока пустое._');
      fm.push('<!-- body:end -->');
      fm.push('');

      if (attachments.length) {
        fm.push('## Вложения');
        fm.push('');
        for (const att of attachments) {
          const rel = attachmentPathById.get(att.id);
          if (!rel) continue;
          fm.push(`- ${attachmentMarkdown(att, rel)}`);
        }
        fm.push('');
      }

      if (ideaLinks.length) {
        fm.push('## Связи');
        fm.push('');
        for (const link of ideaLinks) {
          const otherId = link.from_id === idea.id ? link.to_id : link.from_id;
          const otherBase = fileById.get(otherId);
          if (!otherBase) continue;
          const otherName = otherBase.split('/').pop();
          const otherTitle = link.from_id === idea.id ? link.to_title : link.from_title;
          fm.push(`- ${wikilink(otherName, otherTitle)} (${link.type})`);
        }
        fm.push('');
      }

      if (children.length) {
        fm.push('## Комментарии');
        fm.push('');
        for (const child of children) {
          const childBase = fileById.get(child.id);
          if (!childBase) continue;
          const childName = childBase.split('/').pop();
          fm.push(`- ${wikilink(childName, child.title)} — ${excerpt(child.body, 220)}`);
        }
        fm.push('');
      }

      safeWrite(filePath, fm.join('\n'));
    }
  }

  // Root index
  const index = [];
  index.push('---');
  index.push(`project: ${yamlString(project.slug)}`);
  index.push(`name: ${yamlString(project.name)}`);
  index.push(`stage: ${yamlString(project.stage)}`);
  index.push(`generated: ${yamlString(now())}`);
  index.push('---');
  index.push('');
  index.push(`# ${project.name}`);
  index.push('');
  index.push(project.description || '');
  index.push('');
  index.push('> Это Obsidian-слой Project OS. Рабочая база — SQLite, но vault можно править вручную: после правок запустите импорт (`node cli.mjs import --project multivarka` или кнопку «Импорт из vault»), и изменения вернутся в базу.');
  index.push('');
  index.push('## Разделы');
  index.push('');
  for (const section of sections) {
    const count = (bySection.get(section.id) || []).length;
    index.push(`- [[${sectionDir(section)}/_index|${section.icon} ${section.name}]] — ${count} записей`);
  }
  index.push('');
  index.push('## Статусы');
  index.push('');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    index.push(`- \`${status}\` — ${count}`);
  }
  index.push('');
  index.push('## Быстрые ссылки');
  index.push('');
  index.push('- [[AGENTS]] — правила для ИИ-агентов');
  index.push('- [[README|README проекта]]');
  index.push('- [[PLAN|План проекта]]');
  index.push('- [[_briefs/README|Брифы для агентов]]');
  index.push('- [[_meta/export.json|Манифест экспорта]]');
  safeWrite(join(base, '00_INDEX.md'), index.join('\n'));

  // Базовые файлы проекта. Пользователь может их редактировать:
  // создаём только отсутствующие и никогда не перезаписываем существующие.
  const agentsPath = join(base, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    safeWrite(agentsPath, buildFileTemplate(project, 'agents', sections));
  }
  const readmePath = join(base, 'README.md');
  if (!existsSync(readmePath)) {
    safeWrite(readmePath, buildFileTemplate(project, 'readme', sections));
  }
  const planPath = join(base, 'PLAN.md');
  if (!existsSync(planPath)) {
    safeWrite(planPath, buildFileTemplate(project, 'plan', sections));
  }

  // Briefs
  const briefReadme = [];
  briefReadme.push('# Брифы для агентов');
  briefReadme.push('');
  briefReadme.push('Сгенерированы автоматически. Каждый бриф — задание на один раздел.');
  briefReadme.push('');
  for (const section of sections) {
    const brief = buildSectionBrief(db, project, [section.key], 'audit');
    safeWrite(join(base, '_briefs', `${section.key}.md`), brief);
    briefReadme.push(`- [[${section.key}|${section.icon} ${section.name}]]`);
  }
  safeWrite(join(base, '_briefs', 'README.md'), briefReadme.join('\n'));

  const manifest = {
    project: { id: project.id, slug: project.slug, name: project.name, stage: project.stage },
    generated_at: now(),
    path: base,
    sections: sections.length,
    ideas: ideas.length,
    links: links.length,
    attachments: attachmentPathById.size,
    stats,
  };
  mkdirSync(join(base, '_meta'), { recursive: true });
  safeWrite(join(base, '_meta', 'export.json'), JSON.stringify(manifest, null, 2));

  setSetting(db, `last_export:${project.id}`, now());
  setSetting(db, `last_export_path:${project.id}`, base);
  return manifest;
}

export function cleanExport(base) {
  if (existsSync(base)) rmSync(base, { recursive: true, force: true });
}
