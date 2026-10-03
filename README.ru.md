# 🔍 Vibe Scanner

[English](README.md) · **Русский**

Сканер безопасности для вайбкод-проектов — приложений, написанных с помощью AI
на **Next.js / Vite + Supabase + Vercel**. Ловит ошибки, которые AI-ассистенты
делают чаще всего, **до деплоя**:

- API-ключи прямо в коде (OpenAI, Anthropic, Stripe, AWS, GitHub, Google, Supabase…)
- секреты в публичных переменных окружения (`NEXT_PUBLIC_`, `VITE_`…), которые попадают в браузер
- файлы `.env` в git — в том числе удалённые, но оставшиеся в истории
- таблицы Supabase без Row Level Security и политики `USING (true)`

Для каждой находки — объяснение простыми словами и что сделать.
Ключи в выводе **всегда замаскированы** (`sk-pro…****`).

## Быстрый старт

Нужен Node.js 18+. Зависимостей нет. Запусти в папке своего проекта:

```bash
npx vibecode-scanner .
```

Чтобы коммиты с ключами блокировались, добавь сканер в проект и поставь pre-commit хук:

```bash
npm install -D vibecode-scanner
npx vibecode-scanner install-hook
```

Пакет называется `vibecode-scanner`, а команда, которую он ставит, — `vibe-scanner`.

## Запуск

```bash
vibe-scanner <путь>                      # проверить проект
vibe-scanner <путь> --json               # вывод для программ (AI-слой, сайт)
vibe-scanner <путь> --history            # плюс ключи, удалённые из файлов, но оставшиеся в истории git
vibe-scanner <путь> --exclude fixtures/  # пропустить путь (флаг можно повторять)
vibe-scanner --staged                    # только файлы из git add (то, что уйдёт в коммит)
vibe-scanner install-hook [путь]         # pre-commit хук: блокирует коммит при критичных проблемах
vibe-scanner <путь> --lang ru            # язык отчёта: en (по умолчанию) или ru
```

Без установки — `npx vibecode-scanner` вместо `vibe-scanner`.

Язык отчёта — английский по умолчанию, русский — через `--lang ru` или автоматически, если язык системы русский.
Порядок: `--lang` → `VIBESCAN_LANG` → `LC_ALL` / `LC_MESSAGES` / `LANG` → язык системы → английский.
`install-hook --lang ru` — сообщения хука и отчёт при коммите на русском.

Хук запускает сканер из `node_modules/.bin`, если пакет установлен в проект, иначе — через
`npx vibecode-scanner@<версия>` (версия закреплена: та, что ставила хук; новую сам не скачивает).

Код выхода: `1` — есть критичные или высокие находки, `0` — нет, `2` — ошибка в аргументах.
Поэтому сканер можно сразу ставить в CI.

## Сканер внутри AI-ассистента (MCP + skill)

Claude Code, Cursor или Claude Desktop сами запускают сканер — перед коммитом, после
добавления ключей или переменных окружения, после SQL-миграций — объясняют находки
и исправляют их.

**MCP-сервер.** Работает локально через `npx` по stdio, никуда ничего не отправляет (наших серверов нет).
Инструменты только для чтения: `scan_project`, `scan_staged`, `scan_history`. Ключи всегда
замаскированы, файлы целиком не возвращаются, а код из репозитория помечен как данные,
а не инструкции, — вредоносный файл не сможет «перехватить» ассистента.

<details open>
<summary>Claude Code</summary>

```bash
claude mcp add vibe-scanner -- npx -y vibecode-scanner mcp --lang ru
```

С `--scope project` настройка попадёт в `.mcp.json` и будет у всей команды.
</details>

<details>
<summary>Cursor</summary>

`.cursor/mcp.json` в проекте (или `~/.cursor/mcp.json` для всех проектов):

```json
{
  "mcpServers": {
    "vibe-scanner": { "command": "npx", "args": ["-y", "vibecode-scanner", "mcp", "--lang", "ru"] }
  }
}
```
</details>

<details>
<summary>Claude Desktop</summary>

Settings → Developer → Edit Config, добавь в `claude_desktop_config.json` и перезапусти Claude Desktop:

```json
{
  "mcpServers": {
    "vibe-scanner": { "command": "npx", "args": ["-y", "vibecode-scanner", "mcp", "--lang", "ru"] }
  }
}
```

На Windows, если сервер не запускается: `"command": "cmd", "args": ["/c", "npx", "-y", "vibecode-scanner", "mcp", "--lang", "ru"]`.
Claude Desktop работает не внутри проекта, поэтому попроси проверить конкретную папку
(у инструментов есть параметр `path`).
</details>

`--lang ru` — описания инструментов на русском; язык можно задать и в каждом вызове (`lang`).
Чтобы закрепить версию, пиши `vibecode-scanner@<версия>` вместо `vibecode-scanner`.

**Skill.** Учит ассистента, *когда* запускать сканер и *как* исправлять находки (перенести ключи
в серверные переменные окружения, сказать тебе перевыпустить утёкший ключ, написать миграцию
с RLS) и никогда не обходить pre-commit хук:

```bash
npx vibecode-scanner install-skill            # .claude/skills/ в этом проекте (Claude Code, Agent Skills)
npx vibecode-scanner install-skill --user     # ~/.claude/skills/ для всех твоих проектов
npx vibecode-scanner install-skill --cursor   # .cursor/rules/vibe-scanner.mdc для Cursor
```

Skill работает и без MCP-сервера: тогда ассистент запускает CLI.

## Что проверяется

| Проверка | Уровень |
|---|---|
| Известные форматы ключей (OpenAI, Anthropic, боевой Stripe, AWS, GitHub, Supabase `sb_secret_` / JWT `service_role`, приватные PEM-ключи) | критично |
| Секреты в публичных переменных (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`) | высокий |
| Файлы `.env`, которые попадут (или уже попали) в git | критично |
| Файлы `.env`, которые были в коммите и потом удалены (`--history`) | высокий |
| Ключи, удалённые из файлов, но оставшиеся в истории git (`--history`) | критично |
| SQL-миграции: таблица создана без RLS | критично |
| SQL-миграции: политики `USING (true)` / `WITH CHECK (true)` | высокий / низкий (только чтение) |
| SQL-миграции: таблица меняется, но создана вне миграций — RLS не проверить | средний |
| `.gitignore` не защищает `.env` | средний |
| Ключи Google API (часто публичны по задумке, но их надо ограничить) | средний |
| Возможные захардкоженные пароли, тестовые ключи Stripe | низкий |

`anon`-ключ Supabase публичен по задумке, о нём сканер **не** сообщает.

В git-репозитории проверяются файлы, которые есть в репозитории или попадут туда
при `git add .`, а также игнорируемые `.env*` (только на публичные переменные).

## Чего сканер НЕ проверяет

«Проблем не найдено» ≠ «проект безопасен». Сканер не видит:

- живую базу данных (изменения из панели Supabase) — для этого есть Security Advisor в Supabase;
- логику доступа в коде (может ли пользователь A прочитать данные пользователя B через твой API);
- уязвимые зависимости — для этого есть `npm audit`;
- собранный код (`.next`, `dist`) и настройки хостинга (переменные в Vercel, CORS, заголовки);
- XSS, SQL-инъекции, prompt injection.

## Исключения

Файл `.vibescanignore` в корне проекта (синтаксис — упрощённый `.gitignore`):

```
# комментарий
test-project/      # папка на любой глубине
/docs              # путь от корня проекта
*.min.js           # шаблоны: * и **
```

Или флаг `--exclude <шаблон>`.

## Принципы

- **Обнаружение — только детерминированный код**: регулярки и разбор, AI не решает, что считать уязвимостью.
- **Секреты не покидают твой компьютер** и маскируются в любом выводе.
- **Только твои проекты** — локальная папка или репозиторий, к которому у тебя есть доступ.

## Для разработчиков

Из исходников:

```bash
git clone https://github.com/vipperson1p-wq/vibecode-scanner.git
cd vibecode-scanner
node src/index.js /путь/к/проекту
npm test               # тесты (node:test)
npm run scan:fixture   # прогон на намеренно «дырявом» test-project/
npm run scan:self      # самопроверка сканером
```

Структура:

    src/rules.js       — все правила (обнаружение)
    src/i18n/          — тексты на английском и русском
    src/api.js         — программный API: scan()
    src/mcp.js         — MCP-сервер (stdio, без зависимостей)
    src/skill.js       — install-skill; сам skill — в skills/vibe-scanner/SKILL.md
    src/scan.js        — движок: собирает файлы и применяет правила
    src/detectors/     — отдельные детекторы (history.js — история git)
    src/ignore.js      — исключения (--exclude, .vibescanignore)
    src/hook.js        — pre-commit хук
    src/report.js      — вывод в терминал
    src/index.js       — CLI
    test/              — тесты

Как добавить правило — в [CONTRIBUTING.md](CONTRIBUTING.md).
Нашёл уязвимость в самом сканере? Сообщи приватно — см. [SECURITY.md](SECURITY.md).

## Поддержать проект

Vibe Scanner бесплатный и open source, без подписок. Если он спас тебя от утечки
ключа, можно поддержать разработку:

<!-- TODO: ссылка на донаты -->
*Ссылка на донаты скоро появится.*

## Лицензия

[MIT](LICENSE)
