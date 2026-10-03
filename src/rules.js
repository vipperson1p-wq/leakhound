// Правила сканера. Каждое правило — это то, что можно найти БЕЗ AI:
// регулярные выражения и простая логика. Они работают одинаково каждый раз.
// Тексты (заголовок, «почему опасно», «как исправить») — в src/i18n/en.js и ru.js.

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ---------- 1. Секретные ключи в коде ----------
export const secretRules = [
  {
    id: 'anthropic-key',
    severity: 'critical',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'openai-key',
    severity: 'critical',
    regex: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'stripe-live-key',
    severity: 'critical',
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
  },
  {
    id: 'stripe-test-key',
    severity: 'low',
    regex: /\bsk_test_[A-Za-z0-9]{20,}/g,
  },
  {
    id: 'aws-access-key',
    severity: 'critical',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    severity: 'critical',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g,
  },
  {
    id: 'supabase-secret-key',
    severity: 'critical',
    regex: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'google-api-key',
    severity: 'medium',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'private-key',
    severity: 'critical',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
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
  severity: 'critical',
};

// ---------- 2. Публичные переменные окружения с секретами ----------
// Всё, что начинается с NEXT_PUBLIC_, VITE_ и т.п., попадает в браузер.
export const publicEnvRule = {
  id: 'public-env-secret',
  severity: 'high',
  regex: /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|OPENAI|ANTHROPIC|STRIPE_SECRET)[A-Z0-9_]*/g,
};

// ---------- 3. Подозрительные захардкоженные пароли ----------
export const genericSecretRule = {
  id: 'hardcoded-secret',
  severity: 'low',
  regex: /\b(?:password|passwd|secret|api_?key|apikey|access_?token|auth_?token)\b\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi,
  placeholders: /your|xxx|example|changeme|placeholder|process\.env|import\.meta|<|\$\{/i,
};

// ---------- 4. Файлы .env в репозитории ----------
export const envFileRule = {
  id: 'env-file-committed',
  severity: 'critical',
};

export const gitignoreRule = {
  id: 'gitignore-missing-env',
  severity: 'medium',
};

// ---------- 5. Supabase / SQL ----------
export const rlsMissingRule = {
  id: 'rls-not-enabled',
  severity: 'critical',
};

export const rlsUnverifiedRule = {
  id: 'rls-unverified',
  severity: 'medium',
};

export const permissivePolicyRule = {
  id: 'permissive-policy',
};

// ---------- Чего сканер НЕ проверяет ----------
// Показываем в отчёте, чтобы «проблем не найдено» не читалось как «проект безопасен».
// Тексты — в src/i18n (notChecked.<id>).
export const NOT_CHECKED = ['live-db', 'access-logic', 'dependencies', 'git-history', 'build-output', 'hosting', 'logic-vulns'];
