# Project OS

Локальный мультипроектный трекер идей и база знаний для игровых и контент-проектов. SQLite, веб-интерфейс без сборки, вложения, связи, брифы для ИИ-агентов и Obsidian-совместимый vault.

Репозиторий содержит только код трекера. Данные конкретных проектов, vault, вложения и резервные копии в Git не входят.

---

## Возможности

- Несколько независимых проектов в одной базе.
- Разделы внутри проекта: геймплей, арт, звук, нарратив, технологии и любые другие.
- Записи: идеи, решения, вопросы, исследования, задачи, аудиты, источники, комментарии.
- Статусы: `inbox`, `accepted`, `in_progress`, `needs_rework`, `clarify`, `implemented`, `future`, `rejected`.
- История смены статусов и общая история действий.
- Вложения: изображения и документы, вставка из буфера и drag & drop.
- Связи между записями: related, duplicates, depends, contradicts, implements, source.
- Постоянный ID и прямая ссылка на карточку для передачи агенту или человеку.
- Брифы для агентов по одному или нескольким разделам. Для больших выборок включается компактный режим.
- Экспорт в Obsidian vault и импорт правок обратно.
- Импорт добавляет отсутствующие связи и вложения из vault.
- Новый проект: разделы, стартовые записи, kickoff-промпт и 7 пошаговых промптов.
- CLI и HTTP API для агентов и скриптов.

---

## Требования

- Node.js **22.5+** (используется встроенный `node:sqlite`).
- Windows, macOS или Linux.
- Внешних npm-зависимостей нет.

---

## Быстрый старт

```bash
npm start
```

Откройте **http://127.0.0.1:4317**.

При пустой базе трекер не создаёт демо-проект: откроется мастер создания первого проекта.

Порт и хост можно изменить:

```bash
PORT=4400 npm start
HOST=0.0.0.0 PORT=4317 npm start
```

На Windows также можно запустить `start.cmd` или `start.ps1`.

> Авторизации нет. Не выставляйте приложение в интернет без reverse-proxy и аутентификации.

---

## Где хранятся данные

```
data/
├─ kb.db          SQLite-база
└─ uploads/       вложения

projects/
└─ <slug>/
   └─ vault/      Obsidian-vault проекта

exports/
└─ <slug>/        vault, если export_path проекта задан вне projects/
```

`data/`, `projects/*` и `backups/` исключены из Git через `.gitignore`.

Чтобы перенести рабочий экземпляр на другой компьютер, скопируйте:

- `data/` — база и вложения;
- `projects/` — vault-ы проектов;
- `exports/` — vault-ы проектов, у которых `export_path` задан вне `projects/`;
- при необходимости `backups/`.

Код можно перенести отдельно: после `npm start` он создаст пустую базу и предложит создать проект.

Путь к базе можно переопределить:

```bash
KB_DB=D:\my-data\project-os.db npm start
```

---

## Структура репозитория

```
project-os/
├─ server.mjs              HTTP-сервер и API
├─ cli.mjs                 CLI для агентов и скриптов
├─ lib/
│  ├─ app.mjs              открытие базы без демо-данных
│  ├─ db.mjs               схема SQLite и запросы
│  ├─ templates.mjs        разделы, визард, стартовые промпты
│  ├─ export-vault.mjs     экспорт в Obsidian и сборка брифов
│  ├─ import-vault.mjs     импорт заметок, связей и вложений
│  └─ paths.mjs            пути приложения
├─ public/                 SPA без сборки
│  ├─ index.html
│  ├─ app.css
│  ├─ app.js
│  └─ favicon.svg
├─ scripts/
│  ├─ backup-db.mjs        консистентный снимок SQLite
│  ├─ cleanup-uploads.mjs  удаление orphan-папок вложений
│  └─ backfill-status-history.mjs
├─ backup.ps1              архив базы, vault и кода
├─ start.cmd / start.ps1   запуск на Windows
├─ package.json
└─ README.md
```

---

## Как работать

### 1. Создать проект

Нажмите «+ Проект» и заполните название, жанр, платформы, референсы, питч и столпы.

Трекер создаст:

- структуру разделов;
- 4 стартовые записи;
- kickoff-промпт;
- 7 пошаговых промптов для агента;
- vault в `projects/<slug>/vault`.

### 2. Добавить запись

В ленте заполните раздел, статус, тип, заголовок и текст. Можно добавить теги и вложения: перетащить файл, выбрать через диалог или вставить изображение из буфера.

### 3. Связи и комментарии

В инспекторе записи можно:

- связать её с другой записью;
- добавить комментарий;
- посмотреть историю действий и смены статусов.

### 4. Ссылка на карточку

У каждой записи есть постоянный ID вида `idea_...`. Он не меняется при редактировании и используется в CLI и API.

В инспекторе карточки:

- «Копировать ID» — ID для `node cli.mjs show --id ...` или API;
- «🔗 Ссылка» — прямая ссылка вида `http://127.0.0.1:4317/#/idea/<id>`;
- «Скопировать для агента» — текст карточки с ID, ссылкой, API-адресом и готовой CLI-командой.

Ссылку можно открыть в новой вкладке: трекер сам переключится на нужный проект, откроет карточку и подсветит её. Формат ссылки не зависит от текущего раздела или фильтров.

Для агента достаточно одного из вариантов:

```bash
node cli.mjs show --id idea_...
curl http://127.0.0.1:4317/api/ideas/idea_...
```

### 5. Бриф для агента

1. Откройте «Агенты».
2. Выберите один или несколько разделов.
3. Выберите задачу: `audit`, `refine`, `expand`, `balance`, `art`, `narrative`, `tech`.
4. Нажмите «Собрать бриф».

Если выбрано больше трёх разделов, бриф автоматически становится обзорным: длинные тексты сокращаются, а полные версии остаются в `_briefs/<key>.md`.

### 6. Obsidian

Vault проекта: значение `export_path` проекта (обычно `projects/<slug>/vault` или `exports/<slug>`).

Экспорт:

```bash
node cli.mjs export --project <slug>
```

Импорт правок:

```bash
node cli.mjs import --project <slug>
```

Импорт:

- обновляет существующие записи по `id`;
- создаёт новые заметки;
- добавляет отсутствующие связи и вложения;
- не удаляет связи и вложения, которых нет в заметке.

Для импорта вложений файлы должны лежать в vault, обычно в `_assets/`.

---

## CLI

Из корня проекта:

```bash
node cli.mjs projects
node cli.mjs sections --project <slug>
node cli.mjs list --project <slug> --section monsters --status needs_rework
node cli.mjs search --project <slug> --q "запрос"
node cli.mjs show --id idea_...
node cli.mjs add --project <slug> --section events --title "Новая идея" --body "..." --status inbox
node cli.mjs update --id idea_... --status accepted
node cli.mjs brief --project <slug> --section monsters --task audit
node cli.mjs import --project <slug>
node cli.mjs export --project <slug>
node cli.mjs stats --project <slug>
```

Или через npm:

```bash
npm run kb -- list --project <slug>
npm run kb -- brief --project <slug> --section vision --task audit
```

`--task`: `audit`, `refine`, `expand`, `balance`, `art`, `narrative`, `tech`.

---

## API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/health` | Проверка сервера |
| GET | `/api/meta` | Статусы, типы, разделы шаблона |
| GET | `/api/projects` | Список проектов |
| POST | `/api/projects` | Создать проект |
| GET | `/api/projects/:id` | Проект, разделы, статистика |
| PATCH | `/api/projects/:id` | Обновить проект |
| DELETE | `/api/projects/:id?confirm=1` | Удалить проект и его uploads |
| GET | `/api/projects/:id/sections` | Разделы |
| POST | `/api/projects/:id/sections` | Добавить раздел |
| GET | `/api/projects/:id/ideas` | Записи с фильтрами |
| POST | `/api/projects/:id/ideas` | Создать запись (+ base64-вложения) |
| GET | `/api/ideas/:id` | Запись, вложения, связи, комментарии, история |
| PATCH | `/api/ideas/:id` | Обновить запись |
| DELETE | `/api/ideas/:id` | Удалить запись |
| POST | `/api/ideas/:id/attachments` | Добавить вложения |
| DELETE | `/api/attachments/:id` | Удалить вложение |
| POST | `/api/ideas/:id/links` | Связать записи |
| DELETE | `/api/links/:id` | Удалить связь |
| GET | `/api/projects/:id/graph` | Данные карты связей |
| GET | `/api/projects/:id/stats` | Статистика |
| POST | `/api/projects/:id/brief` | Собрать бриф |
| GET | `/api/projects/:id/agent-runs` | История брифов |
| POST | `/api/projects/:id/export` | Экспорт в Obsidian |
| POST | `/api/projects/:id/import` | Импорт из Obsidian |
| GET | `/api/projects/:id/download` | Скачать JSON базы |

Вложения передаются как base64 в JSON:

```json
{
  "name": "monster.jpeg",
  "mime": "image/jpeg",
  "data": "...base64..."
}
```

Лимиты: 15 МБ на файл, 60 МБ на запрос.

---

## Статусы

| Статус | Смысл |
|---|---|
| `inbox` | входящее предложение |
| `accepted` | принято |
| `in_progress` | в работе |
| `needs_rework` | доработать |
| `clarify` | нужно уточнить |
| `implemented` | реализовано |
| `future` | DLC, спин-офф, следующая версия |
| `rejected` | отклонено, причина обязательна |

Статусы меняет человек. Агент может предлагать записи, но не должен переписывать канон без причины.

---

## Обслуживание

Резервная копия (Windows):

```bash
npm run backup
```

или:

```powershell
.\backup.ps1
```

Скрипт складывает снимок базы, uploads, vault-ы (`projects/` и `exports/`) и код в `backups/project-os-YYYYMMDD-HHMMSS.zip`.

Важно: кнопка «Экспорт» в шапке — это экспорт в Obsidian vault, а не бэкап базы. Полный бэкап делается командой `npm run backup`.

### Перенос на другой компьютер

Самый простой способ: остановить сервер и скопировать папки `data/`, `projects/` и `exports/` (если есть) в такую же папку на другом ПК. База, вложения и vault-ы переедут целиком.

Если используется архив `project-os-*.zip`:

1. Распакуйте архив во временную папку.
2. Скопируйте `backup-snapshot.db` в `data/kb.db`.
3. Скопируйте `uploads/` в `data/uploads/`.
4. Скопируйте `projects/` в `projects/`.
5. Скопируйте `exports/` в `exports/`, если он есть в архиве.
6. Удалите старые `data/kb.db-wal` и `data/kb.db-shm`, если они остались.
7. Код берите из GitHub, а не из архива: в архиве может быть старая версия.

### Обновление трекера на другом ПК

Если папка является git-клоном:

```bash
git fetch origin
git status
git pull --ff-only
npm start
```

`data/`, `projects/` и `exports/` не затрагиваются. Если папка не git-репозиторий, проще клонировать репозиторий заново и перенести в него `data/`, `projects/` и `exports/` (если есть).

Очистка orphan-папок вложений:

```bash
npm run cleanup:uploads
```

Заполнение истории статусов для старых записей:

```bash
npm run backfill:status
```

---

## Ограничения

- Нет авторизации и многопользовательского режима.
- Поиск через `LIKE`, без FTS5.
- Вложения передаются через base64, а не multipart.
- Импорт связей и вложений работает в режиме добавления: удаление в vault не удаляет данные из базы.
- Импорт комментариев как отдельных сущностей пока не реализован.
- Нет версионирования заметок, только история действий и статусов.
- Нет автоматических тестов.

---

## Подготовка к GitHub

В репозиторий не попадают:

- `data/` — рабочая база и uploads;
- `projects/*` — vault-ы и локальные исходники;
- `backups/` — архивы;
- `seed.mjs`, `lib/seed-data.mjs`, `lib/extra-ideas.mjs` — локальные демо-данные;
- игровые миграции в `scripts/`.

Перед публикацией проверьте:

```bash
git status
git ls-files
```

В индексе должны остаться только код, `public/`, документация и общие скрипты.
