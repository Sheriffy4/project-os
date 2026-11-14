/* PROJECT OS — vanilla SPA. No build step, no dependencies. */

const STATUS = {
  inbox: { label: 'Входящие', color: '#8a7764' },
  accepted: { label: 'Принято', color: '#a3e635' },
  in_progress: { label: 'В работе', color: '#4fb3e8' },
  needs_rework: { label: 'Доработать', color: '#ffc53d' },
  clarify: { label: 'Уточнить', color: '#b06ae8' },
  implemented: { label: 'Реализовано', color: '#3ddad7' },
  future: { label: 'Будущее', color: '#8ba3c7' },
  rejected: { label: 'Отклонено', color: '#e04545' },
};
const KIND = {
  idea: 'Идея',
  comment: 'Комментарий',
  decision: 'Решение',
  question: 'Вопрос',
  research: 'Исследование',
  source: 'Источник',
  task: 'Задача',
  audit: 'Аудит',
};
const ENTITY = { n: '—', new: 'Новое', existing: 'Существующее' };
const PRIORITY = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', critical: 'Критический' };
const LINK = {
  related: 'Связано',
  duplicates: 'Дублирует',
  depends: 'Зависит',
  contradicts: 'Противоречит',
  implements: 'Реализует',
  source: 'Источник',
};
const NAV = [
  ['feed', '▤', 'Лента'],
  ['board', '▦', 'Доска'],
  ['sections', '◍', 'Разделы'],
  ['agents', '⚑', 'Агенты'],
  ['graph', '⌘', 'Карта связей'],
  ['files', '✎', 'Файлы проекта'],
  ['wizard', '✦', 'Новый проект'],
  ['export', '↧', 'Экспорт'],
];

const state = {
  meta: null,
  projects: [],
  project: null,
  ideas: [],
  sections: [],
  projectFiles: [],
  selectedId: null,
  selectedIdea: null,
  view: localStorage.getItem('kb.view') || 'feed',
  filters: { status: '', kind: '', entity: '', tag: '', q: '', section: '' },
  composerFiles: [],
  composerSection: '',
  composerOpen: false,
  inspectorOpen: false,
  agents: { selected: new Set(), task: 'audit', extra: '', brief: '', runs: [] },
  wizardResult: null,
  graph: null,
  graphSection: '',
  lastExport: null,
  lastImport: null,
  linkQuery: '',
  loading: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function inlineMd(value) {
  let x = escapeHtml(value);
  x = x.replace(/`([^`]+)`/g, '<code>$1</code>');
  x = x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  x = x.replace(/\*(.+?)\*/g, '<em>$1</em>');
  x = x.replace(/~~(.+?)~~/g, '<del>$1</del>');
  x = x.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return x;
}

function markdown(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  const out = [];
  let inCode = false;
  let code = [];
  let listType = null;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inlineMd(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushPara();
      closeList();
      out.push('<hr>');
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return out.join('');
}

function stripMd(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

function statusBadge(status) {
  return `<span class="status-badge" data-status="${escapeHtml(status)}">${escapeHtml(STATUS[status]?.label || status)}</span>`;
}

function statusOptions(selected, includeEmpty = false) {
  return `${includeEmpty ? '<option value="">Все статусы</option>' : ''}${Object.entries(STATUS)
    .map(([key, meta]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`)
    .join('')}`;
}

function kindOptions(selected, includeEmpty = false) {
  return `${includeEmpty ? '<option value="">Все типы</option>' : ''}${Object.entries(KIND)
    .map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('')}`;
}

function entityOptions(selected, includeEmpty = false) {
  return `${includeEmpty ? '<option value="">Все объекты</option>' : ''}${Object.entries(ENTITY)
    .map(([key, label]) => `<option value="${key === 'n' ? 'n/a' : key}" ${key === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('')}`;
}

function priorityOptions(selected) {
  return Object.entries(PRIORITY)
    .map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

async function api(path, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };
  if (config.body && typeof config.body !== 'string') {
    config.body = JSON.stringify(config.body);
    config.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, type = '') {
  const wrap = $('#toast');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  wrap.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано в буфер', 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Скопировано', 'ok');
  }
}

/* ── Ссылки на карточки ─────────────────────────────────── */

function ideaLink(id) {
  return `${location.origin}${location.pathname}${location.search}#/idea/${encodeURIComponent(id)}`;
}

function ideaIdFromHash(hash = location.hash) {
  const match = String(hash).match(/^#\/idea\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function writeIdeaHash(id) {
  const next = `#/idea/${encodeURIComponent(id)}`;
  if (location.hash === next) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
}

function clearIdeaHash() {
  if (!ideaIdFromHash()) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

function sectionByKey(key) {
  return state.sections.find((s) => s.key === key) || null;
}

function countsByStatus(list = state.ideas) {
  const result = {};
  for (const key of Object.keys(STATUS)) result[key] = 0;
  for (const idea of list) result[idea.status] = (result[idea.status] || 0) + 1;
  return result;
}

function filteredIdeas(includeComments = false, ignoreStatus = false) {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.ideas.filter((idea) => {
    if (!includeComments && idea.kind === 'comment' && f.kind !== 'comment') return false;
    if (f.section && idea.section_key !== f.section) return false;
    if (!ignoreStatus && f.status && idea.status !== f.status) return false;
    if (f.kind && idea.kind !== f.kind) return false;
    if (f.entity && idea.entity_state !== f.entity) return false;
    if (f.tag && !(idea.tags || []).includes(f.tag)) return false;
    if (q) {
      const hay = [idea.title, idea.body, (idea.tags || []).join(' '), idea.source, idea.author, idea.section_name]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function statusStatButton(status, label, color, counts) {
  const active = state.filters.status === status;
  return `<button type="button" class="stat stat-btn ${active ? 'active' : ''}" data-action="filter-status" data-status="${status}" aria-pressed="${active}" title="${active ? 'Сбросить фильтр' : `Показать: ${label}`}">
    <span class="dot" style="color:${color}"></span> ${label} <b>${counts[status] || 0}</b>
  </button>`;
}

function statPills(counts) {
  return [
    ['accepted', 'Принято'],
    ['needs_rework', 'Доработать'],
    ['clarify', 'Уточнить'],
    ['inbox', 'Входящие'],
  ].map(([key, label]) => `<span class="pill" style="color:${STATUS[key].color}">${label} <b>${counts[key] || 0}</b></span>`).join('');
}

/* ── Rendering: shell ───────────────────────────────────── */

function renderTop() {
  const select = $('#project-select');
  if (!select) return;
  const options = state.projects
    .map((p) => `<option value="${escapeHtml(p.slug)}" ${state.project?.slug === p.slug ? 'selected' : ''}>${escapeHtml(p.name)} · ${p.idea_count ?? ''}</option>`)
    .join('');
  select.innerHTML = options;
  const mobileSelect = $('#mobile-project-select');
  if (mobileSelect) mobileSelect.innerHTML = options;
  const search = $('#global-search');
  if (search && search.value !== state.filters.q) search.value = state.filters.q;
}

function renderSidebar() {
  const project = state.project;
  if (!project) return;
  const counts = countsByStatus(state.ideas);
  const total = state.ideas.filter((i) => i.kind !== 'comment').length;
  const missingAgents = state.projectFiles.find((file) => file.key === 'agents' && !file.exists);

  const card = $('#project-card');
  if (card) {
    card.innerHTML = `
      <div class="pc-name">${escapeHtml(project.name)}</div>
      <div class="pc-desc">${escapeHtml(project.description || '')}</div>
      <div class="pc-meta">
        <span class="pill accent">${escapeHtml(project.stage || 'concept')}</span>
        <span class="pill">${total} записей</span>
        <span class="pill amber">${counts.clarify} уточнить</span>
        <span class="pill">${project.export_path || '—'}</span>
      </div>
      ${missingAgents ? '<button class="pc-warning" data-action="view" data-view="files">⚠ AGENTS.md не создан — создать</button>' : ''}`;
  }

  const nav = $('#nav');
  if (nav) {
    const activeView = state.filters.section ? 'sections' : state.view;
    nav.innerHTML = NAV.map(([view, icon, label]) => {
      const count = view === 'feed' ? total : view === 'board' ? total : view === 'sections' ? state.sections.length : '';
      return `<button class="nav-item ${activeView === view ? 'active' : ''}" data-action="view" data-view="${view}">
        <span class="nav-icon">${icon}</span><span>${label}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}
      </button>`;
    }).join('');
  }

  const statusFilter = $('#filter-status');
  if (statusFilter) statusFilter.innerHTML = statusOptions(state.filters.status, true);
  const kindFilter = $('#filter-kind');
  if (kindFilter) kindFilter.innerHTML = kindOptions(state.filters.kind, true);
  const entityFilter = $('#filter-entity');
  if (entityFilter) entityFilter.innerHTML = entityOptions(state.filters.entity === 'n/a' ? 'n' : state.filters.entity, true);
  const tagFilter = $('#filter-tag');
  if (tagFilter && tagFilter.value !== state.filters.tag) tagFilter.value = state.filters.tag;

  const sectionCount = $('#section-count');
  if (sectionCount) sectionCount.textContent = `${state.sections.length}`;

  const list = $('#section-list');
  if (list) {
    list.innerHTML = state.sections.map((section) => {
      const n = state.ideas.filter((i) => i.section_key === section.key && i.kind !== 'comment').length;
      const active = state.filters.section === section.key;
      return `<button class="section-item ${active ? 'active' : ''}" data-action="section" data-section="${escapeHtml(section.key)}">
        <span class="si-icon" style="color:${escapeHtml(section.color)}">${escapeHtml(section.icon)}</span>
        <span class="si-name">${escapeHtml(section.name)}</span>
        ${section.clarify_count ? '<span class="si-dot"></span>' : ''}
        <span class="si-count">${n}</span>
      </button>`;
    }).join('');
  }

  const version = $('#version');
  if (version) version.textContent = `v0.2 · ${state.ideas.length} записей · SQLite`;
}

function renderAll() {
  renderTop();
  renderSidebar();
  renderMain();
  renderInspector();
}

/* ── Rendering: feed ────────────────────────────────────── */

function composerHtml() {
  const sectionKey = state.filters.section || state.composerSection || state.sections[0]?.key || '';
  return `<form id="composer" class="composer dropzone" data-drop="composer">
    <div class="composer-top">
      <div class="composer-title">Новая запись в базу</div>
      <div class="composer-top-actions">
        <span class="hint">Ctrl+Enter — сохранить</span>
        <button class="btn small ghost" type="button" data-action="close-composer">Свернуть</button>
      </div>
    </div>
    <div class="composer-grid">
      <label class="field"><span>Раздел</span><select class="input" name="section" required>
        ${state.sections.map((s) => `<option value="${escapeHtml(s.key)}" ${s.key === sectionKey ? 'selected' : ''}>${escapeHtml(s.icon)} ${escapeHtml(s.name)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Статус</span><select class="input" name="status">${statusOptions('inbox')}</select></label>
      <label class="field"><span>Тип</span><select class="input" name="kind">${kindOptions('idea')}</select></label>
      <label class="field"><span>Объект</span><select class="input" name="entity_state">${entityOptions('new')}</select></label>
    </div>
    <input class="input title-input" name="title" placeholder="О чём идея? Например: «Мутация третья рука»" required autocomplete="off">
    <textarea class="textarea" name="body" rows="3" placeholder="Суть, эффект, ограничения, ссылки. Можно Markdown."></textarea>
    <div class="field-row">
      <input class="input" name="tags" placeholder="Теги через запятую: монстры, радиация, баланс" autocomplete="off">
      <select class="input" name="priority" style="max-width:170px">${priorityOptions('normal')}</select>
    </div>
    <div id="composer-attachments" class="attachments-preview"></div>
    <div class="composer-bottom">
      <label class="btn small ghost attach-btn">📎 Файл<input id="composer-files" type="file" multiple accept="image/*,.txt,.md,.json,.csv,.pdf"></label>
      <span class="hint">Перетащите картинку или текст сюда. До 15 МБ на файл.</span>
      <span class="spacer"></span>
      <button class="btn accent" type="submit">Сохранить запись</button>
    </div>
  </form>`;
}

function renderFeed() {
  const main = $('#main');
  const filtered = filteredIdeas();
  const counts = countsByStatus(filteredIdeas(false, true));
  const activeSection = state.filters.section ? sectionByKey(state.filters.section) : null;
  const missingAgents = state.projectFiles.find((file) => file.key === 'agents' && !file.exists);
  const title = activeSection ? `${escapeHtml(activeSection.icon)} ${escapeHtml(activeSection.name)}` : 'Лента знаний';
  const subtitle = activeSection
    ? `${escapeHtml(activeSection.description || 'Раздел проекта.')} · ${filtered.length} записей`
    : 'Единое место для идей, решений, вопросов и правок. Запись можно привязать к разделу, приложить картинку или документ и отправить агенту.';
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${title}</h1>
        <div class="sub">${subtitle}</div>
      </div>
      <div class="head-actions">
        ${activeSection ? '<button class="btn ghost" data-action="view" data-view="sections">← Все разделы</button>' : ''}
        <button class="btn accent" data-action="focus-composer">+ Новая запись в базу</button>
      </div>
    </div>
    ${missingAgents ? `<div class="file-warning compact">
      <div><b>AGENTS.md не создан.</b> ИИ-агенты не получат правила проекта. Создай файл из шаблона или скопируй промпт для агента.</div>
      <div class="file-warning-actions">
        <button class="btn small accent" data-action="open-file" data-file="agents">Создать из шаблона</button>
        <button class="btn small ghost" data-action="view" data-view="files">Все файлы проекта</button>
      </div>
    </div>` : ''}
    <div class="stat-row">
      ${statusStatButton('accepted', 'Принято', '#a3e635', counts)}
      ${statusStatButton('needs_rework', 'Доработать', '#ffc53d', counts)}
      ${statusStatButton('clarify', 'Уточнить', '#b06ae8', counts)}
      ${statusStatButton('inbox', 'Входящие', '#8a7764', counts)}
      ${statusStatButton('implemented', 'Реализовано', '#3ddad7', counts)}
      ${statusStatButton('future', 'Будущее', '#8ba3c7', counts)}
    </div>
    ${state.composerOpen ? composerHtml() : ''}
    <div class="feed-list" id="idea-list"></div>`;
  renderComposerAttachments();
  renderIdeaList();

  const fileInput = $('#composer-files');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      readFiles(fileInput.files);
      fileInput.value = '';
    });
  }
}

function renderComposerAttachments() {
  const box = $('#composer-attachments');
  if (!box) return;
  box.innerHTML = state.composerFiles.map((file, index) => `
    <span class="attachment-chip">
      ${file.preview ? `<img src="${file.preview}" alt="">` : '<span class="file-ico">▤</span>'}
      <span>${escapeHtml(file.name)}</span>
      <button type="button" data-action="remove-composer-file" data-index="${index}" title="Убрать">×</button>
    </span>`).join('');
}

function renderIdeaList() {
  const list = $('#idea-list');
  if (!list) return;
  const ideas = filteredIdeas();
  if (!ideas.length) {
    list.innerHTML = `<div class="empty"><b>Ничего не найдено.</b><br>Сбросьте фильтры или создайте первую запись.</div>`;
    return;
  }
  list.innerHTML = ideas.map((idea) => {
    const section = sectionByKey(idea.section_key);
    const tags = (idea.tags || []).slice(0, 5);
    return `<article class="idea-card ${state.selectedId === idea.id ? 'selected' : ''}" data-status="${idea.status}" data-action="select" data-id="${idea.id}">
      <div class="idea-stripe"></div>
      <div class="idea-body">
        <div class="idea-meta">
          ${statusBadge(idea.status)}
          <span class="idea-section">${escapeHtml(section?.icon || '•')} ${escapeHtml(section?.name || idea.section_name)}</span>
          <span>${escapeHtml(KIND[idea.kind] || idea.kind)}</span>
          ${idea.entity_state !== 'n/a' ? `<span>${escapeHtml(ENTITY[idea.entity_state] || idea.entity_state)}</span>` : ''}
          ${idea.author ? `<span>· ${escapeHtml(idea.author)}</span>` : ''}
          <span>· ${fmtDate(idea.created_at)}</span>
        </div>
        <div class="idea-title">${escapeHtml(idea.title)}</div>
        <div class="idea-excerpt">${escapeHtml(stripMd(idea.body).slice(0, 320))}</div>
        <div class="idea-footer">
          ${tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}
          ${idea.attachment_count ? `<span class="idea-attach">📎 ${idea.attachment_count}</span>` : ''}
          ${idea.child_count ? `<span class="idea-attach">💬 ${idea.child_count}</span>` : ''}
          ${idea.priority === 'critical' ? '<span class="pill red">critical</span>' : idea.priority === 'high' ? '<span class="pill amber">high</span>' : ''}
        </div>
      </div>
    </article>`;
  }).join('');
}

/* ── Rendering: inspector ───────────────────────────────── */

function renderInspector() {
  const box = $('#inspector');
  if (!box) return;
  if (!state.selectedIdea) {
    box.innerHTML = `<div class="inspector-empty">
      <div class="inspector-head"><span class="label">Инспектор</span></div>
      <h3>Выберите запись</h3>
      <p>Здесь появятся детали, вложения, связи, комментарии и история. Можно менять статус, прикреплять файлы и копировать карточку для агента.</p>
      <div class="legend">
        ${Object.entries(STATUS).map(([key, meta]) => `<div class="legend-row"><span class="legend-dot" style="background:${meta.color}"></span>${meta.label}</div>`).join('')}
      </div>
      <div class="inspector-section-title">Подсказка</div>
      <p class="hint">Статус «Уточнить» — это не заброшенная идея, а вопрос, который нельзя потерять. «В работе» — уже принято и делается. «Будущее» — DLC, спин-офф или следующая часть. «Отклонено» всегда требует причину.</p>
    </div>`;
    return;
  }
  const idea = state.selectedIdea;
  const section = sectionByKey(idea.section_key);
  const attachments = idea.attachments || [];
  const links = idea.links || [];
  const children = idea.children || [];
  box.innerHTML = `
    <div class="inspector-head">
      <span class="label">Карточка · ${escapeHtml(KIND[idea.kind] || idea.kind)}</span>
      <button class="btn small ghost inspector-close" data-action="close-inspector">×</button>
    </div>
    <div class="inspector-card">
      <div class="inspector-meta">${statusBadge(idea.status)} <span class="pill">${escapeHtml(section?.icon || '•')} ${escapeHtml(section?.name || idea.section_name)}</span>${idea.entity_state !== 'n/a' ? `<span class="pill">${escapeHtml(ENTITY[idea.entity_state] || idea.entity_state)}</span>` : ''}</div>
      <div class="inspector-title">${escapeHtml(idea.title)}</div>
      <div class="hint">${idea.author ? `Автор: ${escapeHtml(idea.author)} · ` : ''}${fmtDate(idea.created_at)}${idea.source ? ` · ${escapeHtml(idea.source)}` : ''}</div>
      <div class="idea-ref">
        <span class="idea-ref-label">Код карточки</span>
        <code title="Постоянный ID записи. Используется в CLI и API.">${escapeHtml(idea.id)}</code>
        <div class="idea-ref-actions">
          <button class="btn small ghost" data-action="copy-idea-id" title="Скопировать ID">Копировать ID</button>
          <button class="btn small ghost" data-action="copy-idea-link" title="Скопировать ссылку на карточку">🔗 Ссылка</button>
        </div>
      </div>
      <div class="inspector-actions">
        <button class="btn small" data-action="edit-idea">Редактировать</button>
        <button class="btn small ghost" data-action="copy-idea">Скопировать для агента</button>
        <button class="btn small ghost" data-action="open-link">Связать</button>
        <button class="btn small danger" data-action="delete-idea">Удалить</button>
      </div>
      <label class="field"><span>Статус</span><select class="input" id="inspector-status">${statusOptions(idea.status)}</select></label>
      <label class="field"><span>Приоритет</span><select class="input" id="inspector-priority">${priorityOptions(idea.priority)}</select></label>
      ${idea.rejection_reason && idea.status === 'rejected' ? `<div class="inspector-section-title">Причина отказа</div><div class="hint">${escapeHtml(idea.rejection_reason)}</div>` : ''}
    </div>

    <div class="inspector-section-title">Суть</div>
    <div class="md">${markdown(idea.body || '_Описание пока пустое._')}</div>

    <div class="inspector-section-title">Теги</div>
    <div class="idea-footer">${(idea.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') || '<span class="hint">Нет тегов</span>'}</div>

    <div class="inspector-section-title">Вложения <span class="muted">${attachments.length}</span></div>
    <div class="attachment-grid">
      ${attachments.map((att) => {
        const isImage = String(att.mime).startsWith('image/');
        return `<div class="attachment-card">
          ${isImage
            ? `<a href="${att.url}" target="_blank" rel="noopener"><img src="${att.url}" alt="${escapeHtml(att.file_name)}" loading="lazy"></a><div class="ac-name"><a href="${att.url}" target="_blank" rel="noopener">${escapeHtml(att.file_name)}</a></div>`
            : `<a class="ac-file" href="${att.url}" target="_blank" rel="noopener">▤ ${escapeHtml(att.file_name)}</a>`}
          <button class="ac-del" data-action="delete-attachment" data-id="${att.id}" title="Удалить">×</button>
        </div>`;
      }).join('')}
    </div>
    <div class="field-row attach-row">
      <label class="btn small ghost attach-btn">📎 Прикрепить файл<input id="inspector-file" type="file" accept="image/*,.txt,.md,.json,.csv,.pdf"></label>
      <span class="hint">Картинка или документ, до 15 МБ</span>
    </div>

    <div class="inspector-section-title">Связи <span class="muted">${links.length}</span></div>
    <div>
      ${links.map((link) => `<div class="link-row">
        <div><div class="lr-title">${escapeHtml(link.title)}</div><div class="lr-type">${escapeHtml(LINK[link.type] || link.type)} · ${link.direction === 'out' ? '→' : '←'}</div></div>
        <button data-action="remove-link" data-link-id="${link.id}" title="Убрать связь">×</button>
      </div>`).join('') || '<div class="hint">Связей пока нет.</div>'}
    </div>

    <div class="inspector-section-title">Комментарии <span class="muted">${children.length}</span></div>
    <div>
      ${children.map((child) => `<div class="comment-row"><div><div class="cr-title">${escapeHtml(child.title)}</div><div class="cr-meta">${fmtDate(child.created_at)} · ${escapeHtml(child.author || 'user')}</div><div class="hint">${escapeHtml(stripMd(child.body).slice(0, 260))}</div></div></div>`).join('') || '<div class="hint">Пока нет комментариев.</div>'}
    </div>
    <form id="comment-form" style="margin-top:8px">
      <textarea class="textarea" name="body" rows="2" placeholder="Комментарий к записи…" required></textarea>
      <button class="btn small" type="submit" style="margin-top:6px">Добавить комментарий</button>
    </form>

    <div class="inspector-section-title">История статусов</div>
    <div>${(idea.status_history || []).map((row) => `<div class="activity-row">${fmtDate(row.created_at)} · ${escapeHtml(row.from_status || '—')} → ${escapeHtml(row.to_status)}${row.comment ? ` · ${escapeHtml(row.comment)}` : ''}</div>`).join('') || '<div class="hint">Статус ещё не менялся.</div>'}</div>

    <div class="inspector-section-title">История</div>
    <div>${(idea.activity || []).map((row) => `<div class="activity-row">${fmtDate(row.created_at)} · ${escapeHtml(row.action)}${row.details ? ` · ${escapeHtml(row.details)}` : ''}</div>`).join('') || '<div class="hint">История пуста.</div>'}</div>
  `;
}

/* ── Rendering: board ───────────────────────────────────── */

function renderBoard() {
  const main = $('#main');
  const ideas = filteredIdeas();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Доска статусов</h1><div class="sub">Перетащите карточку в другую колонку, чтобы изменить статус. Отказ всегда требует причины.</div></div>
      <div class="head-actions"><button class="btn ghost" data-action="focus-composer">+ Запись</button></div>
    </div>
    <div class="board">
      ${Object.entries(STATUS).map(([key, meta]) => {
        const list = ideas.filter((i) => i.status === key);
        return `<div class="board-col" data-status="${key}">
          <div class="board-col-head"><span class="legend-dot" style="background:${meta.color}"></span>${meta.label}<span class="count">${list.length}</span></div>
          <div class="board-col-list">
            ${list.map((idea) => `<div class="board-card" draggable="true" data-id="${idea.id}" data-action="select">
              <div class="bc-title">${escapeHtml(idea.title)}</div>
              <div class="bc-meta"><span>${escapeHtml(sectionByKey(idea.section_key)?.icon || '•')}</span><span>${escapeHtml(KIND[idea.kind] || idea.kind)}</span>${idea.attachment_count ? `<span>📎${idea.attachment_count}</span>` : ''}</div>
            </div>`).join('')}
            ${!list.length ? '<div class="hint" style="padding:8px">Пусто</div>' : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ── Rendering: sections ────────────────────────────────── */

function renderSections() {
  const main = $('#main');
  const total = state.ideas.filter((i) => i.kind !== 'comment').length;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Разделы проекта</h1><div class="sub">Полное разделение по составляющим. По каждому разделу можно собрать бриф и отправить отдельного агента на аудит или доработку.</div></div>
      <div class="head-actions"><button class="btn ghost" data-action="add-section">+ Раздел</button></div>
    </div>
    <div class="stat-row"><div class="stat">Всего записей <b>${total}</b></div><div class="stat">Разделов <b>${state.sections.length}</b></div></div>
    <div class="section-grid">
      ${state.sections.map((section) => {
        const list = state.ideas.filter((i) => i.section_key === section.key && i.kind !== 'comment');
        const counts = countsByStatus(list);
        const totalSection = list.length || 1;
        const bar = ['accepted', 'in_progress', 'needs_rework', 'clarify', 'inbox', 'future', 'rejected']
          .map((key) => `<span style="width:${(counts[key] / totalSection) * 100}%;background:${STATUS[key].color}"></span>`)
          .join('');
        return `<div class="section-card" data-action="section-open" data-section="${escapeHtml(section.key)}">
          <div class="sc-top"><div class="sc-icon" style="color:${escapeHtml(section.color)}">${escapeHtml(section.icon)}</div><div><div class="sc-name">${escapeHtml(section.name)}</div><div class="hint">${list.length} записей</div></div></div>
          <div class="sc-desc">${escapeHtml(section.description || '')}</div>
          <div class="sc-bar">${bar}</div>
          <div class="sc-counts">
            ${counts.accepted ? `<span class="pill green">принято ${counts.accepted}</span>` : ''}
            ${counts.needs_rework ? `<span class="pill amber">доработать ${counts.needs_rework}</span>` : ''}
            ${counts.clarify ? `<span class="pill violet">уточнить ${counts.clarify}</span>` : ''}
            ${counts.inbox ? `<span class="pill">входящие ${counts.inbox}</span>` : ''}
          </div>
          <div class="sc-actions">
            <button class="btn small" data-action="section-open" data-section="${escapeHtml(section.key)}">Открыть</button>
            <button class="btn small ghost" data-action="section-brief" data-section="${escapeHtml(section.key)}">Бриф агенту</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ── Rendering: project files ───────────────────────────── */

function formatFileSize(bytes) {
  if (!bytes) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  return `${Math.round(bytes / 1024)} КБ`;
}

function renderFiles() {
  const main = $('#main');
  const files = state.projectFiles || [];
  const agents = files.find((file) => file.key === 'agents');

  if (!files.length) {
    main.innerHTML = `<div class="page-head"><div><h1>Файлы проекта</h1><div class="sub">Базовые документы для людей и ИИ-агентов.</div></div></div>
      <div class="empty">Список файлов не загрузился.<br><button class="btn small" data-action="refresh-files">Обновить</button></div>`;
    return;
  }

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Файлы проекта</h1>
        <div class="sub">Базовые документы проекта. <code>AGENTS.md</code> — главный файл правил для ИИ-агентов; <code>README.md</code> — описание; остальные — обёртки для Claude, Gemini, Cursor и Copilot.</div>
      </div>
      <div class="head-actions"><button class="btn ghost" data-action="refresh-files">Обновить</button></div>
    </div>
    ${!agents?.exists ? `<div class="file-warning">
      <div><b>AGENTS.md не создан.</b> Агенты не получат правила проекта. Создай файл из шаблона или скопируй промпт и передай его агенту.</div>
      <div class="file-warning-actions">
        <button class="btn accent" data-action="open-file" data-file="agents">Создать из шаблона</button>
        <button class="btn ghost" data-action="copy-file-prompt" data-file="agents">Скопировать промпт</button>
      </div>
    </div>` : ''}
    <div class="files-grid">
      ${files.map((file) => `
        <div class="file-card ${file.primary ? 'primary' : ''}">
          <div class="file-card-head">
            <div class="file-card-icon">${escapeHtml(file.icon || '▤')}</div>
            <div class="file-card-name">${escapeHtml(file.name)}</div>
            <span class="pill ${file.exists ? 'green' : 'amber'}">${file.exists ? 'есть' : 'нет'}</span>
            ${file.primary ? '<span class="pill accent">базовый</span>' : ''}
          </div>
          <div class="file-card-desc">${escapeHtml(file.description)}</div>
          <div class="file-card-meta">
            <code>${escapeHtml(file.path)}</code>
            ${file.exists ? `<span>${formatFileSize(file.size)}</span><span>${fmtDate(file.updated_at)}</span>` : '<span>файл ещё не создан</span>'}
          </div>
          <div class="file-card-actions">
            <button class="btn small ${file.exists ? 'ghost' : 'accent'}" data-action="open-file" data-file="${escapeHtml(file.key)}">${file.exists ? 'Открыть' : 'Создать'}</button>
            <button class="btn small ghost" data-action="copy-file-prompt" data-file="${escapeHtml(file.key)}">Промпт агенту</button>
          </div>
        </div>`).join('')}
    </div>
    <div class="hint" style="margin-top:14px">AGENTS.md — основной источник правил. CLAUDE.md, GEMINI.md, .cursor/rules и .github/copilot-instructions.md — короткие обёртки, которые требуют прочитать AGENTS.md. Файлы лежат в vault проекта; экспорт не перезаписывает AGENTS.md и README.md.</div>`;
}

async function openFileEditor(key) {
  if (!state.project) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.project.slug)}/files/${encodeURIComponent(key)}`);
    const file = data.file;
    const content = data.content || '';
    const template = data.template || content;
    openModal(`<button class="modal-close" data-action="close-modal">×</button>
      <h2>${escapeHtml(file.name)}</h2>
      <div class="sub">${escapeHtml(file.path)} · ${file.exists ? 'файл существует' : 'файл ещё не создан — ниже шаблон, проверь и сохрани'}</div>
      <form id="file-form" data-file="${escapeHtml(file.key)}" data-project="${escapeHtml(state.project.slug)}">
        <textarea class="textarea file-editor" name="content" rows="20" spellcheck="false">${escapeHtml(content)}</textarea>
        <textarea id="file-template" class="hidden">${escapeHtml(template)}</textarea>
        <div class="file-editor-actions">
          <button type="button" class="btn small ghost" data-action="toggle-file-preview">Предпросмотр</button>
          <button type="button" class="btn small ghost" data-action="fill-file-template">Шаблон</button>
          <button type="button" class="btn small ghost" data-action="copy-file-content">Копировать</button>
          <span class="hint">Markdown. Сохраняется в vault проекта.</span>
        </div>
        <div id="file-preview" class="md file-preview hidden"></div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">Отмена</button>
          <button type="submit" class="btn accent">Сохранить</button>
        </div>
      </form>`, 'modal-wide');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function copyFilePrompt(key) {
  if (!state.project) return;
  try {
    const { prompt } = await api(`/api/projects/${encodeURIComponent(state.project.slug)}/files/${encodeURIComponent(key)}/prompt`);
    await copyText(prompt);
  } catch (error) {
    toast(error.message, 'err');
  }
}

function toggleFilePreview() {
  const textarea = $('#file-form textarea[name="content"]');
  const preview = $('#file-preview');
  if (!textarea || !preview) return;
  preview.innerHTML = markdown(textarea.value);
  preview.classList.toggle('hidden');
}

function fillFileTemplate() {
  const template = $('#file-template');
  const textarea = $('#file-form textarea[name="content"]');
  if (!template || !textarea) return;
  if (!confirm('Заменить текущее содержимое шаблоном?')) return;
  textarea.value = template.value;
  const preview = $('#file-preview');
  if (preview && !preview.classList.contains('hidden')) preview.innerHTML = markdown(textarea.value);
}

/* ── Rendering: agents ──────────────────────────────────── */

function renderAgents() {
  const main = $('#main');
  const selected = state.agents.selected;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Оркестратор агентов</h1><div class="sub">Выберите разделы и задачу. Система соберёт бриф: принятые решения, спорные места, вопросы, отклонённое и будущее. Агент не должен переписывать канон без причины.</div></div>
      <div class="head-actions"><button class="btn ghost" data-action="agent-all">Выбрать все</button><button class="btn ghost" data-action="agent-none">Снять все</button></div>
    </div>
    <div class="panel">
      <h2>1. Разделы</h2>
      <div class="check-grid">
        ${state.sections.map((s) => `<label class="check-item"><input type="checkbox" class="agent-section" value="${escapeHtml(s.key)}" ${selected.has(s.key) ? 'checked' : ''}><span>${escapeHtml(s.icon)} ${escapeHtml(s.name)}</span></label>`).join('')}
      </div>
    </div>
    <div class="panel">
      <h2>2. Задача</h2>
      <div class="form-grid">
        <label class="field"><span>Тип</span><select class="input" id="agent-task">
          <option value="audit" ${state.agents.task === 'audit' ? 'selected' : ''}>Аудит: противоречия и дыры</option>
          <option value="refine" ${state.agents.task === 'refine' ? 'selected' : ''}>Доработка: механики и цифры</option>
          <option value="expand" ${state.agents.task === 'expand' ? 'selected' : ''}>Расширение: новые идеи</option>
          <option value="balance" ${state.agents.task === 'balance' ? 'selected' : ''}>Баланс: числа и поломки</option>
          <option value="art" ${state.agents.task === 'art' ? 'selected' : ''}>Арт: стиль и пайплайн</option>
          <option value="narrative" ${state.agents.task === 'narrative' ? 'selected' : ''}>Нарратив: сюжет и юмор</option>
          <option value="tech" ${state.agents.task === 'tech' ? 'selected' : ''}>Тех: движок и архитектура</option>
        </select></label>
        <label class="field full"><span>Дополнительное задание (необязательно)</span><input class="input" id="agent-extra" value="${escapeHtml(state.agents.extra)}" placeholder="Например: проверить, нет ли конфликта с реликвиями"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn accent" data-action="agent-generate">Собрать бриф</button>
        ${state.agents.brief ? '<button class="btn ghost" data-action="copy-brief">Скопировать бриф</button>' : ''}
      </div>
      <div class="hint" style="margin-top:8px">Бриф сохраняется в истории запусков. Его можно отдать субагенту одной командой.</div>
    </div>
    ${state.agents.brief ? `<div class="panel"><h2>Бриф</h2><pre class="brief-box">${escapeHtml(state.agents.brief)}</pre></div>` : ''}
    <div class="panel">
      <h2>История запусков</h2>
      <div id="agent-runs"><div class="hint">Загрузка…</div></div>
    </div>`;
  refreshAgentRuns();
}

function renderAgentRuns() {
  const box = $('#agent-runs');
  if (!box) return;
  if (!state.agents.runs.length) {
    box.innerHTML = '<div class="hint">Пока нет запусков. Соберите первый бриф.</div>';
    return;
  }
  box.innerHTML = state.agents.runs.map((run) => `<div class="run-row">
    <div class="rr-main"><div class="rr-title">${escapeHtml(run.task)} · ${(run.sections || []).join(', ')}</div><div class="rr-meta">${fmtDate(run.created_at)} · ${run.status}</div></div>
    <button class="btn small ghost" data-action="view-run" data-id="${run.id}">Открыть</button>
  </div>`).join('');
}

async function refreshAgentRuns() {
  if (!state.project) return;
  try {
    const { runs } = await api(`/api/projects/${state.project.id}/agent-runs`);
    state.agents.runs = runs || [];
    renderAgentRuns();
  } catch {
    const box = $('#agent-runs');
    if (box) box.innerHTML = '<div class="hint">Не удалось загрузить историю.</div>';
  }
}

/* ── Rendering: wizard ──────────────────────────────────── */

function renderWizard() {
  const main = $('#main');
  if (state.wizardResult) {
    const result = state.wizardResult;
    main.innerHTML = `
      <div class="page-head"><div><h1>Проект создан</h1><div class="sub">Структура разделов и стартовые записи уже в базе. Скопируйте промпт и отдайте его агенту для пошагового старта.</div></div></div>
      <div class="panel">
        <h2>${escapeHtml(result.project.name)}</h2>
        <div class="sub">${escapeHtml(result.project.description || '')}</div>
        <div class="stat-row"><div class="stat">Разделов <b>${result.project.sections?.length || 0}</b></div><div class="stat">Записей <b>${result.project.stats?.ideas || 0}</b></div><div class="stat">Путь vault <b>${escapeHtml(result.project.export_path || '—')}</b></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
          <button class="btn accent" data-action="wizard-goto" data-slug="${escapeHtml(result.project.slug)}">Перейти в проект</button>
          <button class="btn ghost" data-action="wizard-copy">Скопировать промпт</button>
          <button class="btn ghost" data-action="wizard-reset">Создать ещё</button>
        </div>
        <pre class="brief-box">${escapeHtml(result.kickoffPrompt)}</pre>
      </div>
      <div class="panel">
        <h2>Пошаговые промпты</h2>
        <div class="sub">Отдавайте их агенту по одному. Каждый шаг сохраняет результат в свой раздел.</div>
        <div style="display:grid;gap:12px;margin-top:12px">
          ${(result.starterPrompts || []).map((step, index) => `<div style="border:1px solid rgba(185,165,142,.22);border-radius:12px;padding:12px;background:rgba(0,0,0,.12)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
              <b>${escapeHtml(step.title)}</b>
              <button class="btn small ghost" data-action="wizard-copy-step" data-index="${index}">Скопировать</button>
            </div>
            <pre class="brief-box" style="max-height:170px;overflow:auto;margin:0">${escapeHtml(step.prompt)}</pre>
          </div>`).join('')}
        </div>
      </div>`;
    return;
  }
  main.innerHTML = `
    <div class="page-head"><div><h1>Новый проект</h1><div class="sub">Визард создаёт структуру разделов, стартовые записи и промпт для пошагового запуска концепта. Это тот же движок, что и база игры — можно вести сколько угодно проектов.</div></div></div>
    <div class="wizard-steps"><span class="wizard-step active">1. Идентичность</span><span class="wizard-step">2. Рамки</span><span class="wizard-step">3. Разделы</span><span class="wizard-step">4. Промпт</span></div>
    <form id="wizard-form" class="panel">
      <h2>Шаг 1. Что создаём</h2>
      <div class="form-grid">
        <label class="field full"><span>Название *</span><input class="input" name="name" required placeholder="Например: «Хроники Пыльного Гаража»"></label>
        <label class="field"><span>Жанр</span><input class="input" name="genre" placeholder="card roguelike, RPG, стратегия…"></label>
        <label class="field"><span>Платформы</span><input class="input" name="platforms" placeholder="PC, Android, iOS…"></label>
        <label class="field full"><span>Референсы</span><input class="input" name="references" placeholder="Slay the Spire, Night of the Full Moon…"></label>
        <label class="field full"><span>Питч в одном абзаце</span><textarea class="textarea" name="description" rows="3" placeholder="Что это, для кого, почему в это будут играть."></textarea></label>
        <label class="field full"><span>Столпы (по одному на строку)</span><textarea class="textarea" name="pillars" rows="3" placeholder="Реиграбельность&#10;Юмор как механика&#10;Читаемость"></textarea></label>
      </div>
      <div class="inspector-section-title">Шаблон разделов</div>
      <div class="check-grid">${(state.meta?.defaultSections || []).map((s) => `<span class="check-item">${escapeHtml(s.icon)} ${escapeHtml(s.name)}</span>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn accent" type="submit">Создать проект</button><span class="hint">Будут созданы разделы и 4 стартовые записи.</span></div>
    </form>`;
}

/* ── Rendering: graph ───────────────────────────────────── */

function renderGraph() {
  const main = $('#main');
  if (!state.graph) {
    main.innerHTML = '<div class="page-head"><div><h1>Карта связей</h1><div class="sub">Загрузка…</div></div></div>';
    loadGraph();
    return;
  }
  const g = state.graph;
  const section = state.graphSection ? state.sections.find((s) => s.key === state.graphSection) : null;
  const width = 1200;
  const height = 680;
  const cx = 600;
  const cy = 330;

  function nodeGroup(x, y, r, color, label, action, extra = '') {
    return `<g class="graph-node" data-action="${action}" ${extra}>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity=".18" stroke="${color}" stroke-width="1.5"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" class="graph-label section" style="fill:${color};font-size:${Math.max(10, r / 2.6)}px">${escapeHtml(label.slice(0, 2))}</text>
      <text x="${x}" y="${y + r + 15}" text-anchor="middle" class="graph-label">${escapeHtml(label.length > 30 ? `${label.slice(0, 28)}…` : label)}</text>
    </g>`;
  }

  let svg = `<svg class="graph-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<circle cx="${cx}" cy="${cy}" r="250" fill="none" stroke="rgba(185,165,142,.08)" stroke-dasharray="3 6"/>`;

  if (!section) {
    const list = g.sections;
    list.forEach((s, index) => {
      const angle = (index / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * 250;
      const y = cy + Math.sin(angle) * 250;
      const count = g.ideas.filter((i) => i.section_id === s.id && i.kind !== 'comment').length;
      svg += `<line class="graph-line" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
      svg += nodeGroup(x, y, 34, s.color || '#e8722a', `${s.icon} ${s.name}`, 'graph-section', `data-section="${escapeHtml(s.key)}"`);
      svg += `<text x="${x}" y="${y - 45}" text-anchor="middle" class="graph-count">${count}</text>`;
    });
    svg += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" class="graph-label section" style="font-size:15px">Выберите раздел</text>`;
    svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" class="graph-count">клик по узлу → идеи</text>`;
  } else {
    const ideas = g.ideas.filter((i) => i.section_id === section.id && i.kind !== 'comment').slice(0, 90);
    const sectionNode = nodeGroup(cx, cy, 46, section.color || '#e8722a', `${section.icon} ${section.name}`, 'graph-all', '');
    svg += sectionNode;
    const positions = new Map();
    ideas.forEach((idea, index) => {
      const angle = (index / Math.max(ideas.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 185 + (index % 3) * 58;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      positions.set(idea.id, { x, y });
      svg += `<line class="graph-line" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
    });
    const ids = new Set(ideas.map((i) => i.id));
    for (const link of g.links) {
      if (!ids.has(link.from_id) || !ids.has(link.to_id)) continue;
      const a = positions.get(link.from_id);
      const b = positions.get(link.to_id);
      if (a && b) svg += `<line class="graph-line cross" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    }
    ideas.forEach((idea) => {
      const { x, y } = positions.get(idea.id);
      const color = STATUS[idea.status]?.color || '#8a7764';
      svg += `<g class="graph-node" data-action="select" data-id="${idea.id}">
        <circle cx="${x}" cy="${y}" r="7" fill="${color}" fill-opacity=".8" stroke="#1a1410" stroke-width="2"/>
        <text x="${x}" y="${y + 18}" text-anchor="middle" class="graph-label">${escapeHtml(idea.title.length > 26 ? `${idea.title.slice(0, 24)}…` : idea.title)}</text>
      </g>`;
    });
  }
  svg += '</svg>';

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Карта связей</h1><div class="sub">Разделы и идеи. Клик по разделу раскрывает идеи и связи. Это визуальная навигация, а не замена Obsidian-графу.</div></div>
      <div class="head-actions">
        ${section ? '<button class="btn ghost" data-action="graph-all">← Все разделы</button>' : ''}
        <button class="btn ghost" data-action="view" data-view="feed">Лента</button>
      </div>
    </div>
    <div class="graph-wrap">${svg}</div>
    <div class="stat-row" style="margin-top:12px">
      ${section ? `<div class="stat">Раздел <b>${escapeHtml(section.name)}</b></div><div class="stat">Идей <b>${g.ideas.filter((i) => i.section_id === section.id).length}</b></div><div class="stat">Связей <b>${g.links.filter((l) => idsHas(g, l, section.id)).length}</b></div>` : `<div class="stat">Разделов <b>${g.sections.length}</b></div><div class="stat">Идей <b>${g.ideas.length}</b></div><div class="stat">Связей <b>${g.links.length}</b></div>`}
    </div>`;
}

function idsHas(g, link, sectionId) {
  const ids = new Set(g.ideas.filter((i) => i.section_id === sectionId).map((i) => i.id));
  return ids.has(link.from_id) && ids.has(link.to_id);
}

async function loadGraph() {
  if (!state.project) return;
  try {
    state.graph = await api(`/api/projects/${state.project.id}/graph`);
    if (state.view === 'graph') renderGraph();
  } catch (error) {
    toast(error.message, 'err');
  }
}

/* ── Rendering: export ──────────────────────────────────── */

function renderExport() {
  const main = $('#main');
  const p = state.project;
  const manifest = state.lastExport;
  main.innerHTML = `
    <div class="page-head"><div><h1>Экспорт и Obsidian</h1><div class="sub">База — источник правды. Vault — читаемое зеркало для Obsidian и агентов. Экспорт создаёт markdown-заметки с YAML, вложения, индексы и брифы по разделам.</div></div></div>
    <div class="panel">
      <h2>Текущий проект</h2>
      <div class="sub">${escapeHtml(p.name)} · ${escapeHtml(p.slug)}</div>
      <div class="export-path">${escapeHtml(p.export_path || 'не задан')}</div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat">Записей <b>${state.ideas.length}</b></div>
        <div class="stat">Разделов <b>${state.sections.length}</b></div>
        <div class="stat">Вложений <b>${state.ideas.reduce((n, i) => n + (i.attachment_count || 0), 0)}</b></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn accent" data-action="export-now">Экспортировать vault</button>
        <a class="btn ghost" href="/api/projects/${p.id}/download">Скачать JSON</a>
        <button class="btn ghost" data-action="view" data-view="agents">Отправить агентов</button>
      </div>
    </div>
    <div class="panel">
      <h2>Импорт правок из Obsidian</h2>
      <div class="sub">Прочитайте заметки из vault и верните изменения в SQLite. Импорт обновляет существующие записи по <code>id</code>, создаёт новые, а также добавляет отсутствующие связи и вложения.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn ghost" data-action="import-now">Импортировать правки</button>
        <span class="hint">Перед импортом можно сделать экспорт, чтобы выровнять структуру.</span>
      </div>
      ${state.lastImport ? `<div class="stat-row" style="margin-top:12px">
        <div class="stat">Проверено <b>${state.lastImport.scanned}</b></div>
        <div class="stat">Создано <b>${state.lastImport.created}</b></div>
        <div class="stat">Обновлено <b>${state.lastImport.updated}</b></div>
        <div class="stat">Без изменений <b>${state.lastImport.unchanged}</b></div>
        <div class="stat">Связей <b>${state.lastImport.links_added || 0}</b></div>
        <div class="stat">Вложений <b>${state.lastImport.attachments_added || 0}</b></div>
        <div class="stat">Ошибок <b>${state.lastImport.errors?.length || 0}</b></div>
      </div>
      ${state.lastImport.errors?.length ? `<div class="hint" style="margin-top:8px">${state.lastImport.errors.map((e) => `${escapeHtml(e.file)}: ${escapeHtml(e.error)}`).join('<br>')}</div>` : ''}` : ''}
    </div>
    ${manifest ? `<div class="panel">
      <h2>Последний экспорт</h2>
      <div class="sub">${escapeHtml(manifest.generated_at)}</div>
      <div class="export-path">${escapeHtml(manifest.path)}</div>
      <div class="export-list">
        <div class="export-item"><b>${manifest.ideas}</b> заметок</div>
        <div class="export-item"><b>${manifest.sections}</b> разделов</div>
        <div class="export-item"><b>${manifest.links}</b> связей</div>
        <div class="export-item"><b>${manifest.attachments}</b> вложений</div>
      </div>
    </div>` : ''}
    <div class="panel">
      <h2>Структура vault</h2>
      <pre class="brief-box">00_INDEX.md
AGENTS.md
01_vision/
02_gameplay/
...
_assets/       ← копии вложений
_briefs/       ← готовые задания агентам
_meta/export.json
_sources/      ← исходные концепты (если прикреплены)</pre>
      <div class="hint" style="margin-top:8px">Vault можно открыть в Obsidian как хранилище. Источник правды остаётся в SQLite: если править заметки вручную, изменения не попадут в базу.</div>
    </div>`;
}

/* ── Rendering: main dispatcher ─────────────────────────── */

function renderMain() {
  if (!state.project) {
    $('#main').innerHTML = '<div class="empty">Нет проектов. Создайте первый через «+ Проект».</div>';
    return;
  }
  if (state.view === 'feed') renderFeed();
  else if (state.view === 'board') renderBoard();
  else if (state.view === 'sections') renderSections();
  else if (state.view === 'agents') renderAgents();
  else if (state.view === 'wizard') renderWizard();
  else if (state.view === 'graph') renderGraph();
  else if (state.view === 'files') renderFiles();
  else if (state.view === 'export') renderExport();
  else renderFeed();
}

/* ── Data actions ───────────────────────────────────────── */

async function loadProject(slug) {
  const { project } = await api(`/api/projects/${encodeURIComponent(slug)}`);
  state.project = project;
  state.sections = project.sections || [];
  state.filters = { status: '', kind: '', entity: '', tag: '', q: '', section: '' };
  state.selectedId = null;
  state.selectedIdea = null;
  state.graph = null;
  state.graphSection = '';
  state.agents.selected = new Set(state.sections.map((s) => s.key));
  state.agents.brief = '';
  state.agents.runs = [];
  state.agents.extra = '';
  state.composerSection = state.sections[0]?.key || '';
  state.composerFiles = [];
  state.composerOpen = false;
  state.wizardResult = null;
  state.lastImport = null;
  state.projectFiles = [];
  const { ideas } = await api(`/api/projects/${project.id}/ideas?limit=5000`);
  state.ideas = ideas;
  await refreshProjectFiles();
  localStorage.setItem('kb.project', project.slug);
  localStorage.setItem('kb.view', state.view);
}

async function refreshProjectFiles() {
  if (!state.project) {
    state.projectFiles = [];
    return;
  }
  try {
    const { files } = await api(`/api/projects/${encodeURIComponent(state.project.slug)}/files`);
    state.projectFiles = files;
  } catch (error) {
    state.projectFiles = [];
    console.warn('[files] cannot load:', error.message);
  }
}

async function reloadIdeas() {
  if (!state.project) return;
  const { ideas } = await api(`/api/projects/${state.project.id}/ideas?limit=5000`);
  state.ideas = ideas;
}

async function refreshSelected() {
  if (!state.selectedId) return;
  try {
    const { idea } = await api(`/api/ideas/${state.selectedId}`);
    state.selectedIdea = idea;
  } catch {
    state.selectedId = null;
    state.selectedIdea = null;
  }
}

async function selectIdea(id) {
  state.selectedId = id;
  state.inspectorOpen = true;
  writeIdeaHash(id);
  const inspector = $('#inspector');
  if (inspector) inspector.classList.add('open');
  try {
    const { idea } = await api(`/api/ideas/${id}`);
    state.selectedIdea = idea;
  } catch (error) {
    toast(error.message, 'err');
  }
  renderIdeaList();
  if (state.view === 'board') renderBoard();
  renderInspector();
  if (window.innerWidth <= 1120) inspector?.scrollTo({ top: 0 });
}

async function openIdeaFromHash() {
  const id = ideaIdFromHash();
  if (!id) return false;
  try {
    const { idea } = await api(`/api/ideas/${encodeURIComponent(id)}`);
    if (!state.project || state.project.slug !== idea.project_slug) {
      await loadProject(idea.project_slug);
    }
    state.selectedId = idea.id;
    state.selectedIdea = idea;
    state.inspectorOpen = true;
    if (!['feed', 'board'].includes(state.view)) {
      state.view = 'feed';
      localStorage.setItem('kb.view', state.view);
    }
    renderAll();
    $('#inspector')?.classList.add('open');
    return true;
  } catch {
    toast(`Карточка не найдена: ${id}`, 'err');
    return false;
  }
}

async function changeStatus(id, status, reason = '') {
  try {
    await api(`/api/ideas/${id}`, { method: 'PATCH', body: { status, rejection_reason: status === 'rejected' ? reason : '' } });
    toast(`Статус: ${STATUS[status]?.label || status}`, 'ok');
    await reloadIdeas();
    await refreshSelected();
    renderSidebar();
    if (state.view === 'feed') renderIdeaList();
    if (state.view === 'board') renderBoard();
    if (state.view === 'sections') renderSections();
    renderInspector();
  } catch (error) {
    toast(error.message, 'err');
    renderInspector();
  }
}

async function deleteIdea() {
  if (!state.selectedIdea) return;
  if (!confirm(`Удалить «${state.selectedIdea.title}»? Это удалит и комментарии, и связи.`)) return;
  try {
    await api(`/api/ideas/${state.selectedIdea.id}`, { method: 'DELETE' });
    state.selectedId = null;
    state.selectedIdea = null;
    clearIdeaHash();
    await reloadIdeas();
    renderAll();
    toast('Запись удалена', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

function readFiles(files, target = 'composer') {
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) {
      toast(`Файл «${file.name}» больше 15 МБ`, 'err');
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const data = dataUrl.split(',')[1] || '';
      const item = {
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data,
        preview: file.type.startsWith('image/') ? dataUrl : null,
      };
      if (target === 'composer') {
        state.composerFiles.push(item);
        renderComposerAttachments();
      } else if (target === 'inspector' && state.selectedIdea) {
        uploadAttachments([item]);
      }
    };
    reader.readAsDataURL(file);
  }
}

async function uploadAttachments(files) {
  if (!state.selectedIdea || !files.length) return;
  try {
    const result = await api(`/api/ideas/${state.selectedIdea.id}/attachments`, {
      method: 'POST',
      body: { attachments: files.map(({ name, mime, data }) => ({ name, mime, data })) },
    });
    if (result.errors?.length) toast(result.errors[0].error, 'err');
    else toast('Вложение добавлено', 'ok');
    await reloadIdeas();
    await refreshSelected();
    renderInspector();
    if (state.view === 'feed') renderIdeaList();
  } catch (error) {
    toast(error.message, 'err');
  }
}

function openModal(html, className = '') {
  const modal = $('#modal');
  modal.innerHTML = `<div class="modal ${className}">${html}</div>`;
  modal.classList.remove('hidden');
}

function closeModal() {
  const modal = $('#modal');
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

function openEditModal() {
  const idea = state.selectedIdea;
  if (!idea) return;
  openModal(`<button class="modal-close" data-action="close-modal">×</button>
    <h2>Редактировать запись</h2>
    <div class="sub">${escapeHtml(idea.title)}</div>
    <form id="edit-form">
      <div class="form-grid">
        <label class="field full"><span>Заголовок</span><input class="input" name="title" value="${escapeHtml(idea.title)}" required></label>
        <label class="field"><span>Раздел</span><select class="input" name="section_id">${state.sections.map((s) => `<option value="${s.id}" ${s.id === idea.section_id ? 'selected' : ''}>${escapeHtml(s.icon)} ${escapeHtml(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Статус</span><select class="input" name="status">${statusOptions(idea.status)}</select></label>
        <label class="field"><span>Тип</span><select class="input" name="kind">${kindOptions(idea.kind)}</select></label>
        <label class="field"><span>Объект</span><select class="input" name="entity_state">${entityOptions(idea.entity_state === 'n/a' ? 'n' : idea.entity_state)}</select></label>
        <label class="field"><span>Приоритет</span><select class="input" name="priority">${priorityOptions(idea.priority)}</select></label>
        <label class="field"><span>Теги</span><input class="input" name="tags" value="${escapeHtml((idea.tags || []).join(', '))}"></label>
        <label class="field full"><span>Текст</span><textarea class="textarea" name="body" rows="8">${escapeHtml(idea.body)}</textarea></label>
        <label class="field full"><span>Причина отказа (если отклонено)</span><input class="input" name="rejection_reason" value="${escapeHtml(idea.rejection_reason || '')}"></label>
      </div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Отмена</button><button class="btn accent" type="submit">Сохранить</button></div>
    </form>`);
}

function openLinkModal() {
  const idea = state.selectedIdea;
  if (!idea) return;
  state.linkQuery = '';
  openModal(`<button class="modal-close" data-action="close-modal">×</button>
    <h2>Связать запись</h2>
    <div class="sub">Найдите запись по названию. Связь двусторонняя: её будет видно в обеих карточках.</div>
    <input class="input" id="link-search" placeholder="Поиск по названию…" autocomplete="off">
    <div id="link-results" style="margin-top:10px;max-height:50vh;overflow:auto"></div>`);
  renderLinkResults('');
  setTimeout(() => $('#link-search')?.focus(), 50);
}

function renderLinkResults(query) {
  const box = $('#link-results');
  if (!box) return;
  const q = String(query || '').toLowerCase().trim();
  const list = state.ideas
    .filter((i) => i.id !== state.selectedIdea?.id)
    .filter((i) => !q || [i.title, i.section_name, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
    .slice(0, 60);
  box.innerHTML = list.length ? list.map((i) => `<div class="link-row">
    <div><div class="lr-title">${escapeHtml(i.title)}</div><div class="lr-type">${escapeHtml(i.section_name)} · ${escapeHtml(STATUS[i.status]?.label || i.status)}</div></div>
    <button class="btn small" data-action="add-link" data-id="${i.id}">Связать</button>
  </div>`).join('') : '<div class="hint">Ничего не найдено.</div>';
}

function openAddSectionModal() {
  openModal(`<button class="modal-close" data-action="close-modal">×</button>
    <h2>Новый раздел</h2>
    <div class="sub">Раздел — это отдельная зона ответственности. По нему можно отправить отдельного агента.</div>
    <form id="section-form">
      <div class="form-grid">
        <label class="field full"><span>Название *</span><input class="input" name="name" required placeholder="Например: Монстры"></label>
        <label class="field"><span>Ключ (латиницей)</span><input class="input" name="key" placeholder="monsters"></label>
        <label class="field"><span>Иконка</span><input class="input" name="icon" value="•" maxlength="4"></label>
        <label class="field"><span>Цвет</span><input class="input" name="color" value="#e8722a" type="color"></label>
        <label class="field full"><span>Описание</span><input class="input" name="description" placeholder="За что отвечает раздел"></label>
      </div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Отмена</button><button class="btn accent" type="submit">Создать</button></div>
    </form>`);
}

async function exportNow() {
  if (!state.project) return;
  try {
    const { manifest } = await api(`/api/projects/${state.project.id}/export`, { method: 'POST' });
    state.lastExport = manifest;
    toast(`Vault обновлён: ${manifest.ideas} заметок`, 'ok');
    if (state.view === 'export') renderExport();
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function importNow() {
  if (!state.project) return;
  if (!confirm('Импортировать правки из vault? Существующие записи обновятся по id, новые заметки будут созданы.')) return;
  try {
    const { result } = await api(`/api/projects/${state.project.id}/import`, { method: 'POST', body: {} });
    state.lastImport = result;
    const { project } = await api(`/api/projects/${state.project.slug}`);
    state.project = project;
    state.sections = project.sections;
    await reloadIdeas();
    if (state.selectedId) await refreshSelected();
    renderSidebar();
    renderMain();
    renderInspector();
    toast(`Импорт: +${result.created}, обновлено ${result.updated}, связи ${result.links_added || 0}, файлы ${result.attachments_added || 0}`, 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

async function generateBrief() {
  if (!state.project) return;
  if (!state.agents.selected.size) {
    toast('Выберите хотя бы один раздел', 'err');
    return;
  }
  try {
    const { brief, run } = await api(`/api/projects/${state.project.id}/brief`, {
      method: 'POST',
      body: {
        sections: [...state.agents.selected],
        task: state.agents.task,
        extra: state.agents.extra,
      },
    });
    state.agents.brief = brief;
    if (run) state.agents.runs.unshift(run);
    renderAgents();
    toast('Бриф собран', 'ok');
  } catch (error) {
    toast(error.message, 'err');
  }
}

/* ── Events ─────────────────────────────────────────────── */

document.addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (actionEl.tagName === 'A' && action !== 'select') return;

  if (action === 'toggle-sidebar') {
    $('#sidebar')?.classList.toggle('open');
    return;
  }
  if (action === 'view') {
    event.preventDefault();
    state.view = actionEl.dataset.view || 'feed';
    state.filters.section = '';
    localStorage.setItem('kb.view', state.view);
    if (state.view === 'agents') refreshAgentRuns();
    if (state.view === 'graph') loadGraph();
    if (state.view === 'files') refreshProjectFiles().then(() => { if (state.view === 'files') renderMain(); });
    renderSidebar();
    renderMain();
    $('#sidebar')?.classList.remove('open');
    return;
  }
  if (action === 'section' || action === 'section-open') {
    state.filters.section = actionEl.dataset.section || '';
    state.composerSection = state.filters.section || state.sections[0]?.key || '';
    state.composerOpen = false;
    state.view = 'feed';
    localStorage.setItem('kb.view', state.view);
    renderSidebar();
    renderMain();
    $('#sidebar')?.classList.remove('open');
    return;
  }
  if (action === 'section-brief') {
    state.agents.selected = new Set([actionEl.dataset.section]);
    state.agents.brief = '';
    state.view = 'agents';
    renderSidebar();
    renderMain();
    return;
  }
  if (action === 'filter-status') {
    const status = actionEl.dataset.status || '';
    state.filters.status = state.filters.status === status ? '' : status;
    renderSidebar();
    renderMain();
    return;
  }
  if (action === 'clear-filters') {
    state.filters = { status: '', kind: '', entity: '', tag: '', q: '', section: '' };
    renderSidebar();
    renderMain();
    return;
  }
  if (action === 'focus-composer') {
    state.view = 'feed';
    state.composerSection = state.filters.section || state.composerSection || state.sections[0]?.key || '';
    state.composerOpen = true;
    renderSidebar();
    renderMain();
    setTimeout(() => $('#composer input[name="title"]')?.focus(), 60);
    return;
  }
  if (action === 'close-composer') {
    state.composerOpen = false;
    renderMain();
    return;
  }
  if (action === 'open-file') {
    await openFileEditor(actionEl.dataset.file);
    return;
  }
  if (action === 'copy-file-prompt') {
    await copyFilePrompt(actionEl.dataset.file);
    return;
  }
  if (action === 'refresh-files') {
    await refreshProjectFiles();
    renderSidebar();
    renderMain();
    return;
  }
  if (action === 'toggle-file-preview') {
    toggleFilePreview();
    return;
  }
  if (action === 'fill-file-template') {
    fillFileTemplate();
    return;
  }
  if (action === 'copy-file-content') {
    const textarea = $('#file-form textarea[name="content"]');
    if (textarea) await copyText(textarea.value);
    return;
  }
  if (action === 'select') {
    event.preventDefault();
    await selectIdea(actionEl.dataset.id);
    return;
  }
  if (action === 'close-inspector') {
    state.inspectorOpen = false;
    $('#inspector')?.classList.remove('open');
    clearIdeaHash();
    return;
  }
  if (action === 'edit-idea') {
    openEditModal();
    return;
  }
  if (action === 'copy-idea') {
    if (!state.selectedIdea) return;
    const idea = state.selectedIdea;
    const text = [
      `Карточка: ${idea.title}`,
      `ID: ${idea.id}`,
      `Ссылка: ${ideaLink(idea.id)}`,
      `API: ${location.origin}/api/ideas/${encodeURIComponent(idea.id)}`,
      `Проект: ${idea.project_name} (${idea.project_slug})`,
      `Раздел: ${idea.section_name}`,
      `Статус: ${STATUS[idea.status]?.label || idea.status}`,
      `Тип: ${KIND[idea.kind] || idea.kind}`,
      `Теги: ${(idea.tags || []).join(', ')}`,
      '',
      idea.body,
      '',
      `Связи: ${(idea.links || []).map((l) => l.title).join('; ') || '—'}`,
      '',
      `CLI: node cli.mjs show --id ${idea.id}`,
    ].join('\n');
    await copyText(text);
    return;
  }
  if (action === 'copy-idea-id') {
    if (!state.selectedIdea) return;
    await copyText(state.selectedIdea.id);
    return;
  }
  if (action === 'copy-idea-link') {
    if (!state.selectedIdea) return;
    await copyText(ideaLink(state.selectedIdea.id));
    return;
  }
  if (action === 'delete-idea') {
    await deleteIdea();
    return;
  }
  if (action === 'remove-composer-file') {
    state.composerFiles.splice(Number(actionEl.dataset.index), 1);
    renderComposerAttachments();
    return;
  }
  if (action === 'delete-attachment') {
    if (!confirm('Удалить вложение?')) return;
    try {
      await api(`/api/attachments/${actionEl.dataset.id}`, { method: 'DELETE' });
      await refreshSelected();
      await reloadIdeas();
      renderInspector();
      toast('Вложение удалено', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
  if (action === 'open-link') {
    openLinkModal();
    return;
  }
  if (action === 'add-link') {
    const target = actionEl.dataset.id;
    if (!state.selectedIdea || !target) return;
    try {
      await api(`/api/ideas/${state.selectedIdea.id}/links`, { method: 'POST', body: { to_id: target, type: 'related' } });
      closeModal();
      await refreshSelected();
      renderInspector();
      toast('Связь добавлена', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
  if (action === 'remove-link') {
    try {
      await api(`/api/links/${actionEl.dataset.linkId}`, { method: 'DELETE' });
      await refreshSelected();
      renderInspector();
      toast('Связь удалена', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
  if (action === 'agent-all') {
    state.agents.selected = new Set(state.sections.map((s) => s.key));
    renderAgents();
    return;
  }
  if (action === 'agent-none') {
    state.agents.selected = new Set();
    renderAgents();
    return;
  }
  if (action === 'agent-generate') {
    await generateBrief();
    return;
  }
  if (action === 'copy-brief') {
    if (state.agents.brief) await copyText(state.agents.brief);
    return;
  }
  if (action === 'view-run') {
    const run = state.agents.runs.find((r) => r.id === actionEl.dataset.id);
    if (run) {
      state.agents.brief = run.brief;
      renderAgents();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }
  if (action === 'graph-section') {
    state.graphSection = actionEl.dataset.section;
    renderMain();
    return;
  }
  if (action === 'graph-all') {
    state.graphSection = '';
    renderMain();
    return;
  }
  if (action === 'export' || action === 'export-now') {
    await exportNow();
    return;
  }
  if (action === 'import-now') {
    await importNow();
    return;
  }
  if (action === 'new-project') {
    state.view = 'wizard';
    state.wizardResult = null;
    renderSidebar();
    renderMain();
    return;
  }
  if (action === 'wizard-goto') {
    await loadProject(actionEl.dataset.slug);
    state.view = 'feed';
    state.wizardResult = null;
    renderAll();
    return;
  }
  if (action === 'wizard-copy') {
    if (state.wizardResult?.kickoffPrompt) await copyText(state.wizardResult.kickoffPrompt);
    return;
  }
  if (action === 'wizard-copy-step') {
    const index = Number(actionEl.dataset.index);
    const prompt = state.wizardResult?.starterPrompts?.[index]?.prompt;
    if (prompt) await copyText(prompt);
    return;
  }
  if (action === 'wizard-reset') {
    state.wizardResult = null;
    renderMain();
    return;
  }
  if (action === 'add-section') {
    openAddSectionModal();
    return;
  }
  if (action === 'close-modal') {
    closeModal();
    return;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.id) return;
  event.preventDefault();

  if (form.id === 'composer') {
    const fd = new FormData(form);
    const payload = {
      section: fd.get('section'),
      status: fd.get('status'),
      kind: fd.get('kind'),
      entity_state: fd.get('entity_state'),
      priority: fd.get('priority'),
      title: String(fd.get('title') || '').trim(),
      body: String(fd.get('body') || ''),
      tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
      author: 'user',
      attachments: state.composerFiles.map(({ name, mime, data }) => ({ name, mime, data })),
    };
    if (!payload.title) return toast('Нужен заголовок', 'err');
    try {
      const { idea, errors } = await api(`/api/projects/${state.project.id}/ideas`, { method: 'POST', body: payload });
      if (errors?.length) toast(errors[0].error, 'err');
      state.composerFiles = [];
      state.composerSection = payload.section;
      state.composerOpen = false;
      await reloadIdeas();
      renderSidebar();
      renderMain();
      await selectIdea(idea.id);
      toast('Запись сохранена', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (form.id === 'file-form') {
    if (!state.project) return;
    const key = form.dataset.file;
    const projectSlug = form.dataset.project || state.project.slug;
    const content = String(new FormData(form).get('content') || '');
    try {
      await api(`/api/projects/${encodeURIComponent(projectSlug)}/files/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { content },
      });
      closeModal();
      await refreshProjectFiles();
      renderSidebar();
      renderMain();
      toast('Файл сохранён', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (form.id === 'comment-form') {
    if (!state.selectedIdea) return;
    const body = String(new FormData(form).get('body') || '').trim();
    if (!body) return;
    try {
      await api(`/api/projects/${state.project.id}/ideas`, {
        method: 'POST',
        body: {
          section: state.selectedIdea.section_key,
          parent_id: state.selectedIdea.id,
          title: `Комментарий к «${state.selectedIdea.title.slice(0, 80)}»`,
          body,
          status: 'inbox',
          kind: 'comment',
          entity_state: 'n/a',
          author: 'user',
        },
      });
      form.reset();
      await reloadIdeas();
      await refreshSelected();
      renderInspector();
      toast('Комментарий добавлен', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (form.id === 'attach-form') {
    const input = form.querySelector('input[type="file"]');
    if (input?.files?.length) readFiles(input.files, 'inspector');
    form.reset();
    return;
  }

  if (form.id === 'link-form') {
    return;
  }

  if (form.id === 'edit-form') {
    if (!state.selectedIdea) return;
    const fd = new FormData(form);
    const patch = {
      title: String(fd.get('title') || '').trim(),
      section_id: fd.get('section_id'),
      status: fd.get('status'),
      kind: fd.get('kind'),
      entity_state: fd.get('entity_state'),
      priority: fd.get('priority'),
      tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
      body: String(fd.get('body') || ''),
      rejection_reason: fd.get('status') === 'rejected' ? String(fd.get('rejection_reason') || '') : '',
    };
    try {
      await api(`/api/ideas/${state.selectedIdea.id}`, { method: 'PATCH', body: patch });
      closeModal();
      await reloadIdeas();
      await refreshSelected();
      renderSidebar();
      renderInspector();
      if (state.view === 'feed') renderIdeaList();
      if (state.view === 'board') renderBoard();
      toast('Сохранено', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (form.id === 'section-form') {
    const fd = new FormData(form);
    try {
      await api(`/api/projects/${state.project.id}/sections`, {
        method: 'POST',
        body: {
          name: fd.get('name'),
          key: fd.get('key') || undefined,
          icon: fd.get('icon') || '•',
          color: fd.get('color') || '#e8722a',
          description: fd.get('description') || '',
        },
      });
      closeModal();
      const { project } = await api(`/api/projects/${state.project.slug}`);
      state.project = project;
      state.sections = project.sections;
      state.agents.selected = new Set(state.sections.map((s) => s.key));
      renderSidebar();
      renderMain();
      toast('Раздел создан', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (form.id === 'wizard-form') {
    const fd = new FormData(form);
    const body = {
      name: String(fd.get('name') || '').trim(),
      genre: String(fd.get('genre') || ''),
      platforms: String(fd.get('platforms') || '').split(',').map((s) => s.trim()).filter(Boolean),
      references: String(fd.get('references') || '').split(',').map((s) => s.trim()).filter(Boolean),
      description: String(fd.get('description') || ''),
      pillars: String(fd.get('pillars') || '').split('\n').map((s) => s.trim()).filter(Boolean),
      starter: true,
    };
    if (!body.name) return toast('Нужно название', 'err');
    try {
      const result = await api('/api/projects', { method: 'POST', body });
      state.wizardResult = result;
      const { projects } = await api('/api/projects');
      state.projects = projects;
      renderTop();
      renderMain();
      toast('Проект создан', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
});

document.addEventListener('change', async (event) => {
  const target = event.target;

  if (target.id === 'project-select' || target.id === 'mobile-project-select') {
    try {
      await loadProject(target.value);
      clearIdeaHash();
      renderAll();
      $('#sidebar')?.classList.remove('open');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }

  if (target.id === 'filter-status') {
    state.filters.status = target.value;
    renderSidebar();
    if (state.view === 'feed') renderIdeaList();
    else if (state.view === 'board') renderBoard();
    else { state.view = 'feed'; renderMain(); }
    return;
  }
  if (target.id === 'filter-kind') {
    state.filters.kind = target.value;
    renderSidebar();
    if (state.view === 'feed') renderIdeaList();
    else if (state.view === 'board') renderBoard();
    else { state.view = 'feed'; renderMain(); }
    return;
  }
  if (target.id === 'filter-entity') {
    state.filters.entity = target.value;
    renderSidebar();
    if (state.view === 'feed') renderIdeaList();
    else if (state.view === 'board') renderBoard();
    else { state.view = 'feed'; renderMain(); }
    return;
  }
  if (target.id === 'filter-tag') {
    state.filters.tag = target.value.trim();
    if (state.view === 'feed') renderIdeaList();
    else if (state.view === 'board') renderBoard();
    return;
  }
  if (target.id === 'inspector-status') {
    const idea = state.selectedIdea;
    if (!idea) return;
    let reason = '';
    if (target.value === 'rejected') {
      const entered = prompt('Причина отказа (обязательно):', idea.rejection_reason || '');
      if (entered === null) {
        renderInspector();
        return;
      }
      reason = entered.trim();
      if (!reason) {
        toast('Для отказа нужна причина', 'err');
        renderInspector();
        return;
      }
    }
    await changeStatus(idea.id, target.value, reason);
    return;
  }
  if (target.id === 'inspector-priority') {
    if (!state.selectedIdea) return;
    try {
      await api(`/api/ideas/${state.selectedIdea.id}`, { method: 'PATCH', body: { priority: target.value } });
      await reloadIdeas();
      await refreshSelected();
      renderInspector();
      if (state.view === 'feed') renderIdeaList();
      toast('Приоритет обновлён', 'ok');
    } catch (error) {
      toast(error.message, 'err');
    }
    return;
  }
  if (target.classList?.contains('agent-section')) {
    if (target.checked) state.agents.selected.add(target.value);
    else state.agents.selected.delete(target.value);
    return;
  }
  if (target.id === 'agent-task') {
    state.agents.task = target.value;
    return;
  }
  if (target.id === 'agent-extra') {
    state.agents.extra = target.value;
    return;
  }
  if (target.id === 'composer-files') {
    readFiles(target.files);
    target.value = '';
    return;
  }
  if (target.id === 'inspector-file') {
    readFiles(target.files, 'inspector');
    target.value = '';
    return;
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'global-search') {
    state.filters.q = target.value;
    if (state.view !== 'feed') {
      state.view = 'feed';
      renderSidebar();
      renderMain();
    } else {
      renderIdeaList();
    }
    return;
  }
  if (target.id === 'link-search') {
    renderLinkResults(target.value);
    return;
  }
  if (target.id === 'agent-extra') {
    state.agents.extra = target.value;
    return;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
    $('#sidebar')?.classList.remove('open');
    $('#inspector')?.classList.remove('open');
    return;
  }
  const tag = document.activeElement?.tagName;
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    event.preventDefault();
    $('#global-search')?.focus();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    const form = document.activeElement?.closest('form');
    if (form?.id === 'composer') form.requestSubmit();
  }
});

document.addEventListener('paste', (event) => {
  const inComposer = event.target.closest?.('#composer');
  const inInspector = event.target.closest?.('#inspector');
  if (!inComposer && !inInspector) return;
  const items = event.clipboardData?.items || [];
  const files = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) return;
  event.preventDefault();
  readFiles(files, inComposer ? 'composer' : 'inspector');
});

document.addEventListener('dragover', (event) => {
  const col = event.target.closest('.board-col');
  const drop = event.target.closest('[data-drop="composer"]');
  if (col || drop) {
    event.preventDefault();
    if (col) col.classList.add('dragover');
    if (drop) drop.classList.add('dragover');
  }
});

document.addEventListener('dragleave', (event) => {
  const col = event.target.closest('.board-col');
  const drop = event.target.closest('[data-drop="composer"]');
  if (col) col.classList.remove('dragover');
  if (drop) drop.classList.remove('dragover');
});

document.addEventListener('drop', async (event) => {
  const col = event.target.closest('.board-col');
  const drop = event.target.closest('[data-drop="composer"]');
  if (!col && !drop) return;
  event.preventDefault();
  if (col) col.classList.remove('dragover');
  if (drop) drop.classList.remove('dragover');

  if (col) {
    const id = event.dataTransfer.getData('text/plain');
    const status = col.dataset.status;
    if (!id || !status || !STATUS[status]) return;
    let reason = '';
    if (status === 'rejected') {
      const entered = prompt('Причина отказа (обязательно):');
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) return toast('Для отказа нужна причина', 'err');
    }
    await changeStatus(id, status, reason);
    return;
  }

  if (drop && event.dataTransfer.files?.length) {
    readFiles(event.dataTransfer.files, 'composer');
  }
});

document.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.board-card');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.id);
  event.dataTransfer.effectAllowed = 'move';
});

/* ── Init ───────────────────────────────────────────────── */

window.addEventListener('hashchange', () => {
  if (ideaIdFromHash()) {
    openIdeaFromHash();
    return;
  }
  if (state.inspectorOpen) {
    state.inspectorOpen = false;
    $('#inspector')?.classList.remove('open');
  }
});

async function init() {
  try {
    const meta = await api('/api/meta');
    state.meta = meta;
    const { projects } = await api('/api/projects');
    state.projects = projects;
    if (!projects.length) {
      state.view = 'wizard';
      renderTop();
      renderMain();
      return;
    }
    const lastSlug = localStorage.getItem('kb.project');
    const project = projects.find((p) => p.slug === lastSlug) || projects[0];
    await loadProject(project.slug);
    if (!NAV.some(([view]) => view === state.view)) state.view = 'feed';
    renderAll();
    await openIdeaFromHash();
    const version = $('#version');
    if (version) version.textContent = `v0.2 · ${meta.statuses.length} статусов · SQLite`;
  } catch (error) {
    console.error(error);
    $('#main').innerHTML = `<div class="empty"><b>Не удалось загрузить базу.</b><br>${escapeHtml(error.message)}<br><br>Проверьте, что сервер запущен: <code>node project-os/server.mjs</code></div>`;
    toast(error.message, 'err');
  }
}

init();
