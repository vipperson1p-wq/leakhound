# 🔍 Vibe Scanner (v0.1)

Сканер безопасности для вайбкод-проектов. Ищет утёкшие ключи, открытые .env и таблицы Supabase без RLS.

## Запуск

Нужен только Node.js 18+, зависимостей нет.

    node src/index.js /путь/к/твоему/проекту
    node src/index.js /путь/к/проекту --json    # вывод для AI-слоя и сайта
    node src/index.js . --exclude fixtures/     # пропустить папку (флаг можно повторять)
    npm test                                     # юнит-тесты (node:test)
    npm run scan:fixture                         # прогон на тестовом «дырявом» проекте
    npm run scan:self                            # самопроверка сканером

## Что проверяется

- Ключи: OpenAI, Anthropic, Stripe, AWS, GitHub, Google, Supabase (service_role и sb_secret_), приватные PEM-ключи
- Секреты в публичных переменных (NEXT_PUBLIC_, VITE_, REACT_APP_, EXPO_PUBLIC_)
- Файлы .env, которые попадут в git, и .gitignore без защиты .env
- SQL-миграции: таблицы без RLS и политики USING (true)
- Подозрительные захардкоженные пароли (низкий приоритет, возможны ложные срабатывания)

## Структура

    src/rules.js   — все правила (добавляй новые сюда)
    src/scan.js    — движок: собирает файлы и применяет правила
    src/report.js  — вывод в терминал
    src/ignore.js  — исключения (--exclude, .vibescanignore)
    src/index.js   — точка входа
    test/          — тесты на node:test

## Исключения

Файл `.vibescanignore` в корне проекта (синтаксис — упрощённый `.gitignore`):

    # комментарий
    test-project/      # папка на любой глубине
    /docs              # путь от корня проекта
    *.min.js           # шаблоны: * и **

То же можно передать флагом `--exclude <шаблон>`.

Если папка — git-репозиторий, проверяются только файлы, которые есть или попадут в репозиторий.
Ключи в отчёте всегда маскируются.
