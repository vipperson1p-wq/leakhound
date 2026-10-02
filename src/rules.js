// Правила сканера. Каждое правило — это то, что можно найти БЕЗ AI:
// регулярные выражения и простая логика. Они работают одинаково каждый раз.

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ---------- 1. Секретные ключи в коде ----------
export const secretRules = [
  {
    id: 'anthropic-key',
    title: 'Ключ Anthropic (Claude) в коде',
    severity: 'critical',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    why: 'С этим ключом любой может делать запросы к Claude за твой счёт.',
    fix: 'Отзови ключ в консоли Anthropic, создай новый и храни его в переменной окружения на сервере.',
  },
  {
    id: 'openai-key',
    title: 'Ключ OpenAI в коде',
    severity: 'critical',
    regex: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
    why: 'С этим ключом любой может тратить твои деньги на OpenAI API.',
    fix: 'Отзови ключ на platform.openai.com, создай новый и используй его только на сервере через process.env.',
  },
  {
    id: 'stripe-live-key',
    title: 'Боевой секретный ключ Stripe',
    severity: 'critical',
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
    why: 'Даёт доступ к платежам, возвратам и данным клиентов.',
    fix: 'Немедленно отзови ключ в панели Stripe и перенеси новый в переменные окружения сервера.',
  },
  {
    id: 'stripe-test-key',
    title: 'Тестовый ключ Stripe в коде',
    severity: 'low',
    regex: /\bsk_test_[A-Za-z0-9]{20,}/g,
    why: 'Тестовый ключ не трогает реальные деньги, но это плохая привычка: так же легко закоммитить боевой.',
    fix: 'Перенеси ключ в .env и убедись, что .env в .gitignore.',
  },
  {
    id: 'aws-access-key',
    title: 'Ключ доступа AWS',
    severity: 'critical',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    why: 'Боты ищут такие ключи на GitHub за минуты и запускают майнеры на твоём аккаунте.',
    fix: 'Деактивируй ключ в AWS IAM, проверь счёт на подозрительную активность, создай новый ключ.',
  },
  {
    id: 'github-token',
    title: 'Токен GitHub',
    severity: 'critical',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g,
    why: 'Даёт доступ к твоим репозиториям, включая приватные.',
    fix: 'Отзови токен в GitHub → Settings → Developer settings и создай новый с минимальными правами.',
  },
  {
    id: 'supabase-secret-key',
    title: 'Секретный ключ Supabase (sb_secret_)',
    severity: 'critical',
    regex: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
    why: 'Секретный ключ обходит RLS и даёт полный доступ ко всей базе данных.',
    fix: 'Сгенерируй новый ключ в Supabase → Project Settings → API Keys, используй его только на сервере.',
  },
  {
    id: 'google-api-key',
    title: 'Ключ Google API',
    severity: 'medium',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    why: 'Некоторые ключи Google (например, Firebase) публичны по задумке, но без ограничений их могут использовать другие.',
    fix: 'В Google Cloud Console ограничь ключ по домену и по списку разрешённых API.',
  },
  {
    id: 'private-key',
    title: 'Приватный ключ (PEM)',
    severity: 'critical',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
    why: 'Приватный ключ позволяет выдать себя за твой сервер или сервис.',
    fix: 'Удали ключ из репозитория, перевыпусти его и храни вне кода.',
  },
];

// Известные фейковые ключи из официальной документации — не сообщаем о них.
export const KNOWN_EXAMPLE_KEYS = new Set([
  'AKIAIOSFODNN7EXAMPLE', // AWS docs
  'AKIAI44QH8DHBEXAMPLE', // AWS docs
]);

// JWT обрабатываем отдельно: декодируем и смотрим роль.
// anon-ключ Supabase публичен по задумке, а service_role — нет.
export const jwtRegex = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export const serviceRoleRule = {
  id: 'supabase-service-role',
  title: 'Ключ service_role Supabase в коде',
  severity: 'critical',
  why: 'Этот ключ обходит все RLS-политики. Кто его увидит — получит полный доступ к базе: читать, менять, удалять.',
  fix: 'Сбрось ключ (Supabase → Project Settings → API) и используй service_role только в серверном коде через переменную окружения. В браузере — только anon-ключ.',
};

// ---------- 2. Публичные переменные окружения с секретами ----------
// Всё, что начинается с NEXT_PUBLIC_, VITE_ и т.п., попадает в браузер.
export const publicEnvRule = {
  id: 'public-env-secret',
  title: 'Секрет в публичной переменной окружения',
  severity: 'high',
  regex: /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|OPENAI|ANTHROPIC|STRIPE_SECRET)[A-Z0-9_]*/g,
  why: 'Переменные с префиксом NEXT_PUBLIC_ / VITE_ / REACT_APP_ встраиваются в JavaScript, который скачивает браузер. Их видит любой посетитель.',
  fix: 'Убери публичный префикс, используй переменную только на сервере (API-роут, серверный компонент, edge-функция).',
};

// ---------- 3. Подозрительные захардкоженные пароли ----------
export const genericSecretRule = {
  id: 'hardcoded-secret',
  title: 'Возможный захардкоженный пароль или ключ',
  severity: 'low',
  regex: /\b(?:password|passwd|secret|api_?key|apikey|access_?token|auth_?token)\b\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi,
  placeholders: /your|xxx|example|changeme|placeholder|process\.env|import\.meta|<|\$\{/i,
  why: 'Похоже на пароль или ключ прямо в коде. Может быть ложным срабатыванием — проверь вручную.',
  fix: 'Если это реальный секрет — перенеси его в переменную окружения.',
};

// ---------- 4. Файлы .env в репозитории ----------
export const envFileRule = {
  id: 'env-file-committed',
  title: 'Файл .env попадёт (или уже попал) в репозиторий',
  severity: 'critical',
  why: 'Все ключи из .env становятся видны каждому, у кого есть доступ к репозиторию. Если репозиторий публичный — всему интернету. Удаление файла не помогает: он остаётся в истории git.',
  fix: 'Добавь .env* в .gitignore, выполни `git rm --cached <файл>`, и ОБЯЗАТЕЛЬНО перевыпусти все ключи из этого файла.',
};

export const gitignoreRule = {
  id: 'gitignore-missing-env',
  title: '.gitignore не защищает файлы .env',
  severity: 'medium',
  why: 'Одна команда `git add .` — и все ключи окажутся в репозитории.',
  fix: 'Добавь в .gitignore строки:\n.env\n.env.*\n!.env.example',
};

// ---------- 5. Supabase / SQL ----------
export const rlsMissingRule = {
  id: 'rls-not-enabled',
  title: 'Таблица без Row Level Security',
  severity: 'critical',
  why: 'В Supabase anon-ключ публичен. Если у таблицы в схеме public не включён RLS, любой может читать, менять и удалять все строки через API.',
  fix: 'Добавь в миграцию: ALTER TABLE <таблица> ENABLE ROW LEVEL SECURITY; и создай политики, которые разрешают доступ только нужным пользователям.',
};

export const permissivePolicyRule = {
  id: 'permissive-policy',
  title: 'Политика RLS разрешает всё (USING true)',
  why: 'Политика с условием true пропускает любого пользователя, включая анонимного. RLS включён, но фактически не защищает.',
  fix: 'Замени true на реальное условие, например: USING (auth.uid() = user_id).',
};
