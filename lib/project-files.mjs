import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { APP_ROOT } from './paths.mjs';

export const PROJECT_FILE_DEFS = [
  {
    key: 'agents',
    path: 'AGENTS.md',
    name: 'AGENTS.md',
    icon: '🤖',
    primary: true,
    description: 'Главные правила для ИИ-агентов: источник правды, CLI, статусы, ссылки на карточки.',
  },
  {
    key: 'readme',
    path: 'README.md',
    name: 'README.md',
    icon: '◈',
    primary: true,
    description: 'Краткое описание проекта, стадия, платформы, разделы и быстрый старт.',
  },
  {
    key: 'plan',
    path: 'PLAN.md',
    name: 'PLAN.md',
    icon: '▣',
    primary: true,
    description: 'План реализации: цель, этапы, вехи, риски, критерии готовности.',
  },
  {
    key: 'claude',
    path: 'CLAUDE.md',
    name: 'CLAUDE.md',
    icon: '✦',
    description: 'Инструкции для Claude Code. Ссылаются на AGENTS.md.',
  },
  {
    key: 'gemini',
    path: 'GEMINI.md',
    name: 'GEMINI.md',
    icon: '◆',
    description: 'Инструкции для Gemini CLI. Ссылаются на AGENTS.md.',
  },
  {
    key: 'cursor',
    path: '.cursor/rules/project.mdc',
    name: '.cursor/rules/project.mdc',
    icon: '⌘',
    description: 'Правило Cursor с alwaysApply: true. Ссылается на AGENTS.md.',
  },
  {
    key: 'copilot',
    path: '.github/copilot-instructions.md',
    name: '.github/copilot-instructions.md',
    icon: '◇',
    description: 'Инструкции для GitHub Copilot. Ссылаются на AGENTS.md.',
  },
];

function getDef(key) {
  const def = PROJECT_FILE_DEFS.find((item) => item.key === key);
  if (!def) throw new Error(`Неизвестный файл: ${key}`);
  return def;
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return String(value || '').trim() || '—';
}

function sectionLines(sections = []) {
  return sections.map((section) => `- \`${section.key}\` — **${section.name}**: ${section.description || 'без описания'}`).join('\n');
}

function projectFacts(project) {
  const meta = project.meta || {};
  return {
    name: project.name || project.slug,
    slug: project.slug,
    description: project.description || '—',
    stage: project.stage || 'concept',
    genre: asList(meta.genre),
    platforms: asList(meta.platforms),
    references: asList(meta.references),
    audience: asList(meta.audience),
    vault: project.export_path || `exports/${project.slug}`,
  };
}

function baseUrl() {
  return `http://127.0.0.1:${process.env.PORT || 4317}`;
}

function buildAgentsTemplate(project, sections = []) {
  const f = projectFacts(project);
  const lines = [];
  lines.push('---');
  lines.push(`project: ${f.slug}`);
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push('managed_by: project-os');
  lines.push('---');
  lines.push('');
  lines.push(`# AGENTS.md — правила проекта «${f.name}»`);
  lines.push('');
  lines.push('> Это главный файл правил для ИИ-агентов. Прочитай его полностью до любых изменений в проекте.');
  lines.push('> Файл можно редактировать вручную: экспорт Project OS его не перезаписывает.');
  lines.push('');
  lines.push('## Проект');
  lines.push('');
  lines.push(`- Название: ${f.name}`);
  lines.push(`- Slug: \`${f.slug}\``);
  lines.push(`- Стадия: ${f.stage}`);
  lines.push(`- Жанр: ${f.genre}`);
  lines.push(`- Платформы: ${f.platforms}`);
  lines.push(`- Референсы: ${f.references}`);
  lines.push(`- Питч: ${f.description}`);
  lines.push('');
  lines.push('## Источник правды');
  lines.push('');
  lines.push('- SQLite Project OS — единственный источник правды.');
  lines.push(`- Vault \`${f.vault}\` — markdown-зеркало для Obsidian и агентов.`);
  lines.push('- Сгенерированные файлы `00_INDEX.md`, `_briefs/`, `_meta/` и `*/_index.md` не редактируй: они перезаписываются при экспорте.');
  lines.push('- `AGENTS.md` и `README.md` — редактируемые базовые файлы проекта.');
  lines.push('');
  lines.push('## Разделы проекта');
  lines.push('');
  lines.push(sectionLines(sections) || '- Пока нет разделов.');
  lines.push('');
  lines.push('## Как работать с базой');
  lines.push('');
  lines.push('```bash');
  lines.push(`node cli.mjs sections --project ${f.slug}`);
  lines.push(`node cli.mjs list --project ${f.slug} --limit 100`);
  lines.push(`node cli.mjs list --project ${f.slug} --section <key> --status <status> --q "..."`);
  lines.push('node cli.mjs show --id <idea_id>');
  lines.push(`node cli.mjs add --project ${f.slug} --section <key> --title "..." --body "..." --status inbox`);
  lines.push('node cli.mjs update --id <idea_id> --status accepted');
  lines.push('node cli.mjs update --id <idea_id> --status implemented --resolution "Что сделано" --proof "src/main.asm:10-40"');
  lines.push('node cli.mjs update --id <idea_id> --status rejected --rejection-reason "Причина"');
  lines.push(`node cli.mjs brief --project ${f.slug} --section <key> --task audit`);
  lines.push(`node cli.mjs export --project ${f.slug}`);
  lines.push(`node cli.mjs import --project ${f.slug}`);
  lines.push('```');
  lines.push('');
  lines.push('## Ссылки на карточки');
  lines.push('');
  lines.push('- В интерфейсе открой карточку: «Копировать ID», «🔗 Ссылка», «Скопировать для агента».');
  lines.push(`- URL: \`${baseUrl()}/#/idea/<id>\``);
  lines.push(`- API: \`GET ${baseUrl()}/api/ideas/<id>\``);
  lines.push('- CLI: `node cli.mjs show --id <id>`');
  lines.push('- Не ищи карточку перебором текста: используй ID, ссылку или API.');
  lines.push('');
  lines.push('## Статусы');
  lines.push('');
  lines.push('`inbox` — входящее предложение; `accepted` — принято; `in_progress` — в работе; `needs_rework` — доработать; `clarify` — нужно уточнить; `implemented` — реализовано; `future` — будущее/DLC; `rejected` — отклонено, причина обязательна.');
  lines.push('');
  lines.push('## Результат и пруфы');
  lines.push('');
  lines.push('- При переводе в `implemented` обязательно заполни `resolution` — что именно сделано.');
  lines.push('- В `proof` добавь ссылки на файлы и строки (`src/main.asm:120-145`), URL или прикрепи скриншот в карточке.');
  lines.push('- При переводе в `rejected` обязательно заполни `rejection_reason`.');
  lines.push('- Не закрывай задачу как успешную без результата и пруфов. Комментарий «сделано» без деталей недостаточен.');
  lines.push('');
  lines.push('## Правила');
  lines.push('');
  lines.push('- Не меняй статусы `accepted` и `rejected` без человека.');
  lines.push('- Не удаляй чужие записи и не переписывай канон без причины.');
  lines.push('- Не тащи в текущую версию то, что помечено `future` или `rejected`.');
  lines.push('- Не выдумывай факты, ссылки, цифры и имена.');
  lines.push('- Перед работой прочитай бриф и нужные карточки; после работы обнови статус и добавь комментарий.');
  lines.push('- Крупные решения фиксируй отдельной записью `decision`, спорные — `question`/`clarify`.');
  lines.push('- Если данных не хватает — пиши «нужно уточнить», а не придумывай.');
  lines.push('');
  lines.push('## Формат ответа агента');
  lines.push('');
  lines.push('1. Что работает.');
  lines.push('2. Противоречия и дыры.');
  lines.push('3. Предложения с эффектом, риском и статусом.');
  lines.push('4. Новые вопросы.');
  lines.push('5. Один следующий шаг.');
  lines.push('');
  return lines.join('\n');
}

function buildReadmeTemplate(project, sections = []) {
  const f = projectFacts(project);
  const lines = [];
  lines.push(`# ${f.name}`);
  lines.push('');
  lines.push(`> ${f.description}`);
  lines.push('');
  lines.push('## Кратко');
  lines.push('');
  lines.push(`- Slug: \`${f.slug}\``);
  lines.push(`- Стадия: ${f.stage}`);
  lines.push(`- Жанр: ${f.genre}`);
  lines.push(`- Платформы: ${f.platforms}`);
  lines.push(`- Референсы: ${f.references}`);
  lines.push(`- Vault: \`${f.vault}\``);
  lines.push('');
  lines.push('## Разделы');
  lines.push('');
  lines.push(sectionLines(sections) || '- Пока нет разделов.');
  lines.push('');
  lines.push('## Быстрый старт');
  lines.push('');
  lines.push('1. Открой Project OS и выбери проект.');
  lines.push('2. Прочитай `AGENTS.md` — там правила для ИИ-агентов и команды CLI.');
  lines.push('3. Добавляй решения и задачи через веб-интерфейс или `node cli.mjs`.');
  lines.push('4. После правок в vault запусти импорт: `node cli.mjs import --project ' + f.slug + '`.');
  lines.push('');
  lines.push('## Ссылки');
  lines.push('');
  lines.push('- [AGENTS.md](AGENTS.md) — правила для агентов.');
  lines.push(`- [00_INDEX.md](00_INDEX.md) — индекс vault.`);
  lines.push('');
  return lines.join('\n');
}

function buildPlanTemplate(project, sections = []) {
  const f = projectFacts(project);
  const lines = [];
  lines.push('---');
  lines.push(`project: ${f.slug}`);
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push('managed_by: project-os');
  lines.push('---');
  lines.push('');
  lines.push(`# PLAN.md — план проекта «${f.name}»`);
  lines.push('');
  lines.push('> Рабочий план реализации. Обновляй его, когда меняются этапы, риски или критерии готовности.');
  lines.push('');
  lines.push('## Цель');
  lines.push('');
  lines.push(`- ${f.description}`);
  lines.push(`- Стадия: ${f.stage}`);
  lines.push(`- Платформы: ${f.platforms}`);
  lines.push('');
  lines.push('## Рамки и не-цели');
  lines.push('');
  lines.push('- Что входит в текущую версию: …');
  lines.push('- Что явно не входит: …');
  lines.push('');
  lines.push('## Этапы');
  lines.push('');
  lines.push('### 1. Вертикальный срез');
  lines.push('');
  lines.push('- Результат: …');
  lines.push('- Критерий готовности: …');
  lines.push('');
  lines.push('### 2. Основная функциональность');
  lines.push('');
  lines.push('- Результат: …');
  lines.push('- Критерий готовности: …');
  lines.push('');
  lines.push('### 3. Полировка и релиз');
  lines.push('');
  lines.push('- Результат: …');
  lines.push('- Критерий готовности: …');
  lines.push('');
  lines.push('## Вехи');
  lines.push('');
  lines.push('- [ ] Прототип');
  lines.push('- [ ] Alpha');
  lines.push('- [ ] Beta');
  lines.push('- [ ] Release');
  lines.push('');
  lines.push('## Риски');
  lines.push('');
  lines.push('| Риск | Вероятность | Влияние | Что делаем |');
  lines.push('|---|---|---|---|');
  lines.push('| … | … | … | … |');
  lines.push('');
  lines.push('## Разделы проекта');
  lines.push('');
  lines.push(sectionLines(sections) || '- Пока нет разделов.');
  lines.push('');
  lines.push('## Следующий шаг');
  lines.push('');
  lines.push('- …');
  lines.push('');
  return lines.join('\n');
}

function buildClaudeTemplate(project) {
  const f = projectFacts(project);
  return `# CLAUDE.md — ${f.name}

Этот проект использует общий файл правил \`AGENTS.md\`.
Перед любыми изменениями прочитай \`AGENTS.md\` целиком и следуй ему.

Коротко:
- SQLite Project OS — источник правды, vault — зеркало.
- Не меняй \`accepted\`/\`rejected\` без человека.
- Для карточек используй ID и \`node cli.mjs show --id <id>\`.
- Не выдумывай факты; если данных нет — пиши «нужно уточнить».

Slug проекта: \`${f.slug}\`.
`;
}

function buildGeminiTemplate(project) {
  const f = projectFacts(project);
  return `# GEMINI.md — ${f.name}

Этот проект использует общий файл правил \`AGENTS.md\`.
Прочитай \`AGENTS.md\` перед работой и следуй ему.

- SQLite Project OS — источник правды.
- Vault \`${f.vault}\` — markdown-зеркало.
- Карточки ищи по ID: \`node cli.mjs show --id <id>\`.
- Статусы меняет человек; агент предлагает, но не переписывает канон.
`;
}

function buildCursorTemplate(project) {
  const f = projectFacts(project);
  return `---
description: Правила проекта ${f.name}
alwaysApply: true
---

# ${f.name}

Перед изменениями прочитай \`AGENTS.md\` в корне проекта и следуй ему.

- Источник правды — SQLite Project OS, vault — зеркало.
- Не меняй \`accepted\`/\`rejected\` без человека.
- Используй ID карточек и \`node cli.mjs show --id <id>\`.
- Не выдумывай факты и не удаляй чужие записи.
`;
}

function buildCopilotTemplate(project) {
  const f = projectFacts(project);
  return `# GitHub Copilot instructions — ${f.name}

Перед работой прочитай \`AGENTS.md\` и следуй правилам проекта.

- SQLite Project OS — источник правды; vault — markdown-зеркало.
- Не меняй статусы \`accepted\`/\`rejected\` без человека.
- Для карточек используй ID и CLI/API, а не поиск по тексту.
- Не выдумывай факты, ссылки и цифры.
`;
}

export function buildFileTemplate(project, key, sections = []) {
  if (key === 'agents') return buildAgentsTemplate(project, sections);
  if (key === 'readme') return buildReadmeTemplate(project, sections);
  if (key === 'plan') return buildPlanTemplate(project, sections);
  if (key === 'claude') return buildClaudeTemplate(project);
  if (key === 'gemini') return buildGeminiTemplate(project);
  if (key === 'cursor') return buildCursorTemplate(project);
  if (key === 'copilot') return buildCopilotTemplate(project);
  throw new Error(`Неизвестный файл: ${key}`);
}

export function buildFilePrompt(project, key, sections = []) {
  const def = getDef(key);
  const f = projectFacts(project);
  const lines = [];
  lines.push('# Задача для ИИ-агента');
  lines.push('');
  lines.push(`Проект: «${f.name}» (\`${f.slug}\`).`);
  lines.push(`Нужно создать или обновить файл \`${def.path}\` в vault \`${f.vault}\`.`);
  lines.push('');
  lines.push('Сначала прочитай проект:');
  lines.push('');
  lines.push('```bash');
  lines.push(`node cli.mjs sections --project ${f.slug}`);
  lines.push(`node cli.mjs list --project ${f.slug} --limit 50`);
  lines.push(`node cli.mjs brief --project ${f.slug} --task audit --no-save`);
  lines.push('```');
  lines.push('');
  if (key === 'agents') {
    lines.push('Файл `AGENTS.md` должен содержать:');
    lines.push('- назначение проекта и краткие факты;');
    lines.push('- источник правды и правила работы с vault;');
    lines.push('- список разделов проекта;');
    lines.push('- команды CLI для чтения, добавления, обновления и брифа;');
    lines.push('- формат ссылок на карточки (ID, URL, API, CLI);');
    lines.push('- статусы и правила, что агенту нельзя делать;');
    lines.push('- требование к implemented: resolution + proof; к rejected: rejection_reason;');
    lines.push('- формат ответа агента.');
  } else if (key === 'readme') {
    lines.push('Файл `README.md` должен содержать краткое описание проекта, стадию, платформы, разделы, быстрый старт и ссылку на `AGENTS.md`. Не дублируй весь AGENTS.md.');
  } else if (key === 'plan') {
    lines.push('Файл `PLAN.md` должен содержать цель, рамки и не-цели, этапы, вехи, риски, критерии готовности и следующий шаг.');
    lines.push('После создания плана заведи ключевые задачи и решения в разделах проекта через CLI и не закрывай их без resolution/proof.');
  } else {
    lines.push(`Файл \`${def.name}\` должен быть короткой инструкцией для конкретного инструмента. Он обязан требовать прочитать \`AGENTS.md\` и не дублировать его целиком.`);
  }
  lines.push('');
  lines.push('Правила:');
  lines.push('- Не выдумывай факты, цифры и ссылки.');
  lines.push('- Не меняй статусы `accepted`/`rejected` без человека.');
  lines.push('- При закрытии задачи в `implemented` заполняй `resolution` и `proof`; без этого задача не считается закрытой.');
  lines.push('- При `rejected` обязательно заполняй `rejection_reason`.');
  lines.push('- Пиши по-русски, если в проекте нет другой договорённости.');
  lines.push('- Верни только содержимое файла в Markdown, без пояснений вокруг.');
  return lines.join('\n');
}

export function projectVaultDir(project) {
  const exportPath = project.export_path || `exports/${project.slug}`;
  const base = resolve(APP_ROOT, exportPath);
  if (base === APP_ROOT || base === resolve(APP_ROOT, '..')) {
    throw new Error('Некорректный export_path проекта');
  }
  return base;
}

export function listProjectFiles(project) {
  const base = projectVaultDir(project);
  return PROJECT_FILE_DEFS.map((def) => {
    const absolute = join(base, def.path);
    let exists = false;
    let size = 0;
    let updated_at = '';
    try {
      const stat = statSync(absolute);
      exists = stat.isFile();
      size = stat.size;
      updated_at = stat.mtime.toISOString();
    } catch {
      // Файла ещё нет.
    }
    return { ...def, exists, size, updated_at };
  });
}

export function readProjectFile(project, key) {
  const def = getDef(key);
  const absolute = join(projectVaultDir(project), def.path);
  if (!existsSync(absolute)) return null;
  const stat = statSync(absolute);
  if (!stat.isFile()) return null;
  return readFileSync(absolute, 'utf8');
}

export function writeProjectFile(project, key, content) {
  const def = getDef(key);
  const absolute = join(projectVaultDir(project), def.path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, String(content ?? ''), 'utf8');
  return listProjectFiles(project).find((file) => file.key === key);
}
