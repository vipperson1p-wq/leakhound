import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  secretRules, jwtRegex, serviceRoleRule, publicEnvRule, genericSecretRule,
  envFileRule, gitignoreRule, rlsMissingRule, rlsUnverifiedRule, permissivePolicyRule, SEVERITY_ORDER, KNOWN_EXAMPLE_KEYS,
  NOT_CHECKED,
} from './rules.js';
import { readIgnoreFiles, compileIgnore } from './ignore.js';
import { ScanError } from './i18n/index.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vercel',
  'coverage', '.turbo', '.cache', '.svelte-kit', 'vendor', '.expo',
]);
const IGNORED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.gz',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.mp3', '.wav', '.mov', '.exe', '.dll', '.so',
]);
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

// ---------- Сбор файлов ----------

// Если это git-репозиторий, берём только файлы, которые в нём есть
// или попадут туда при следующем `git add .` (не игнорируемые).
export function listFiles(root) {
  try {
    const out = execSync('git ls-files -z --cached --others --exclude-standard', {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const files = [...new Set(out.split('\0').filter(Boolean))];
    return { mode: 'git', files };
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          files.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    };
    walk(root);
    return { mode: 'folder', files };
  }
}

// .env-файлы, скрытые через .gitignore. В git они не попадут, но публичные
// переменные (NEXT_PUBLIC_ и т.п.) из них всё равно уходят в браузер.
// --directory сворачивает игнорируемые папки (node_modules), их не обходим.
function listIgnoredEnvFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    }).toString();
    return out.split('\0').filter((p) => p && !p.endsWith('/') && isEnvFile(path.posix.basename(p)));
  } catch {
    return [];
  }
}

export function shouldSkip(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (IGNORED_FILES.has(base)) return true;
  if (BINARY_EXT.has(path.extname(base).toLowerCase())) return true;
  return false;
}

export function readText(abs) {
  try {
    const stat = fs.statSync(abs);
    if (stat.size > MAX_FILE_SIZE) return null;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) return null; // бинарный файл
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// ---------- Вспомогательные функции ----------

export const isEnvFile = (base) => /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base);

// Грубая эвристика: попадает ли этот файл в браузер
function isClientFile(rel, content) {
  const p = rel.replace(/\\/g, '/');
  if (/['"]use client['"]/.test(content)) return true;
  if (/(^|\/)(api|server|functions)\//.test(p) || /\.server\./.test(p) || /middleware\.[jt]s$/.test(p)) return false;
  if (/(^|\/)(components|hooks|public)\//.test(p)) return true;
  if (/\.(vue|svelte)$/.test(p)) return true;
  return null; // непонятно
}

const lineOf = (content, index) => content.slice(0, index).split('\n').length;

export const mask = (secret) => `${secret.slice(0, 6)}…****`;

function snippet(content, index, secret) {
  const start = content.lastIndexOf('\n', index) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  let line = content.slice(start, end);
  if (secret) line = line.split(secret).join(mask(secret));
  line = line.trim();
  return line.length > 160 ? line.slice(0, 157) + '...' : line;
}

export function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Findings are language-neutral: texts come from src/i18n by ruleId.
// extra.variant picks an alternative "why" (rules.<id>.why_<variant>),
// extra.params fill {placeholders}, extra.snippetKey makes a localized synthetic snippet.
export function makeFinding(rule, file, line, extra = {}) {
  return {
    ruleId: rule.id,
    severity: extra.severity || rule.severity,
    file,
    line,
    snippet: extra.snippet || null,
    clientSide: extra.clientSide ?? null,
    ...(extra.variant && { variant: extra.variant }),
    ...(extra.params && { params: extra.params }),
    ...(extra.snippetKey && { snippetKey: extra.snippetKey }),
    ...(extra.commit && { commit: extra.commit }),
  };
}

// ---------- Проверки отдельных файлов ----------

export function scanSecrets(rel, content, findings = []) {
  const client = isClientFile(rel, content);
  const reported = new Set(); // чтобы не дублировать одно и то же место

  for (const rule of secretRules) {
    for (const m of content.matchAll(rule.regex)) {
      if (KNOWN_EXAMPLE_KEYS.has(m[0])) continue;
      const key = `${m.index}`;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push(makeFinding(rule, rel, lineOf(content, m.index), {
        snippet: snippet(content, m.index, m[0]), clientSide: client,
      }));
    }
  }

  for (const m of content.matchAll(jwtRegex)) {
    const payload = decodeJwtPayload(m[0]);
    if (payload?.role === 'service_role') {
      findings.push(makeFinding(serviceRoleRule, rel, lineOf(content, m.index), {
        snippet: snippet(content, m.index, m[0]), clientSide: client,
      }));
    }
    // role === 'anon' — публичный ключ, это нормально
  }

  const seenVars = new Set();
  for (const m of content.matchAll(publicEnvRule.regex)) {
    if (seenVars.has(m[0])) continue;
    seenVars.add(m[0]);
    // Значение переменной скрываем — это может быть настоящий ключ
    const safe = snippet(content, m.index).replace(/([=:]\s*["'`]?)([^\s"'`,;)]{4,})/, '$1…****');
    findings.push(makeFinding(publicEnvRule, rel, lineOf(content, m.index), { snippet: safe }));
  }

  for (const m of content.matchAll(genericSecretRule.regex)) {
    const value = m[1];
    if (genericSecretRule.placeholders.test(value)) continue;
    // Если значение уже поймано точным правилом — пропускаем
    if (secretRules.some((r) => new RegExp(r.regex.source).test(value))) continue;
    if (new RegExp(jwtRegex.source).test(value)) continue;
    findings.push(makeFinding(genericSecretRule, rel, lineOf(content, m.index), {
      snippet: snippet(content, m.index, value),
    }));
  }
  return findings;
}


// .env в обычной папке (не в git) — нормальное место для секретов.
// Проверяем только публичные переменные: они попадут в браузер.
const PUBLIC_ENV_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_)/;

export function scanEnvFile(rel, content, findings = []) {
  const reported = new Set();
  for (const m of content.matchAll(publicEnvRule.regex)) {
    const lineNo = lineOf(content, m.index);
    reported.add(lineNo);
    const safe = snippet(content, m.index).replace(/([=:]\s*["'`]?)([^\s"'`,;)]{4,})/, '$1…****');
    findings.push(makeFinding(publicEnvRule, rel, lineNo, { snippet: safe }));
  }

  content.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\s#]*)/);
    if (!m || !PUBLIC_ENV_PREFIX.test(m[1]) || reported.has(i + 1)) return;
    const value = m[2];
    if (new RegExp(`^${jwtRegex.source}$`).test(value) && decodeJwtPayload(value)?.role === 'service_role') {
      findings.push(makeFinding(serviceRoleRule, rel, i + 1, {
        snippet: `${m[1]}=${mask(value)}`,
        clientSide: true,
        variant: 'publicEnv',
        params: { name: m[1] },
      }));
    }
  });
  return findings;
}
// SQL-проверки собираем по всем файлам сразу: таблица может быть создана
// в одной миграции, а RLS включён в другой.
const normTable = (name) => name.replace(/"/g, '').toLowerCase().replace(/^public\./, '');

// Statements that use an existing table: alter / policy / grant / index / trigger
const TABLE_NAME = '((?:"?\\w+"?\\.)?"?\\w+"?)';
const TABLE_REF_RES = [
  new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(?:only\\s+)?${TABLE_NAME}`, 'gi'),
  new RegExp(`create\\s+policy\\s+(?:"[^"]+"|\\w+)\\s+on\\s+${TABLE_NAME}`, 'gi'),
  new RegExp(`grant\\s+[^;]*?\\s+on\\s+(?:table\\s+)?${TABLE_NAME}\\s+to\\b`, 'gi'),
  new RegExp(`create\\s+(?:unique\\s+)?index\\s+[^;]*?\\s+on\\s+(?:only\\s+)?${TABLE_NAME}`, 'gi'),
  new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+[^;]*?\\s+on\\s+${TABLE_NAME}`, 'gi'),
];
const NOT_TABLES = new Set(['function', 'schema', 'sequence', 'all', 'table', 'only']);
const inPublic = (name) => {
  const raw = name.replace(/"/g, '').toLowerCase();
  return !raw.includes('.') || raw.startsWith('public.');
};

export function scanSqlFiles(sqlFiles, findings = []) {
  const created = []; // { table, file, line }
  const createdSet = new Set();
  const referenced = new Map(); // table → first { file, line }
  const rlsEnabled = new Set();

  // По имени файла: миграции обычно начинаются с даты, так первое упоминание — самое раннее
  const ordered = [...sqlFiles].sort((a, b) => a.rel.localeCompare(b.rel));
  for (const { rel, content } of ordered) {
    for (const re of TABLE_REF_RES) {
      for (const m of content.matchAll(re)) {
        const table = normTable(m[1]);
        if (!inPublic(m[1]) || NOT_TABLES.has(table) || referenced.has(table)) continue;
        referenced.set(table, { file: rel, line: lineOf(content, m.index) });
      }
    }
  }

  for (const { rel, content } of sqlFiles) {
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
    for (const m of content.matchAll(createRe)) {
      const raw = m[1].replace(/"/g, '').toLowerCase();
      if (raw.includes('.') && !raw.startsWith('public.')) continue; // auth., private. и т.п.
      created.push({ table: normTable(m[1]), file: rel, line: lineOf(content, m.index) });
      createdSet.add(normTable(m[1]));
    }

    const rlsRe = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+enable\s+row\s+level\s+security/gi;
    for (const m of content.matchAll(rlsRe)) rlsEnabled.add(normTable(m[1]));

    for (const m of content.matchAll(/create\s+policy[^;]*;/gi)) {
      const stmt = m[0];
      if (!/(using|with\s+check)\s*\(\s*true\s*\)/i.test(stmt)) continue;
      const selectOnly = /\bfor\s+select\b/i.test(stmt);
      findings.push(makeFinding(permissivePolicyRule, rel, lineOf(content, m.index), {
        severity: selectOnly ? 'low' : 'high',
        variant: selectOnly ? 'selectOnly' : undefined,
        snippet: stmt.replace(/\s+/g, ' ').slice(0, 160),
      }));
    }
  }

  for (const t of created) {
    if (!rlsEnabled.has(t.table)) {
      findings.push(makeFinding(rlsMissingRule, t.file, t.line, {
        snippetKey: 'rlsMissing',
        params: { table: t.table },
      }));
    }
  }

  // Таблица используется в миграциях, но создана где-то ещё (обычно в панели Supabase).
  // Включён ли на ней RLS — по коду не узнать, и молчать об этом нельзя.
  for (const [table, ref] of referenced) {
    if (createdSet.has(table) || rlsEnabled.has(table)) continue;
    findings.push(makeFinding(rlsUnverifiedRule, ref.file, ref.line, {
      snippetKey: 'rlsUnverified',
      params: { table },
    }));
  }
  return findings;
}

// ---------- Главная функция ----------

// Файлы, добавленные в индекс (git add), пути относительно root
function listStagedFiles(root) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--relative', '-z', '--diff-filter=ACMR'], {
    cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  }).toString();
  return out.split('\0').filter(Boolean);
}

// Содержимое файла в индексе — именно то, что попадёт в коммит
function readStaged(root, rel) {
  try {
    const buf = execFileSync('git', ['show', `:./${rel.replace(/\\/g, '/')}`], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 * MAX_FILE_SIZE,
    });
    if (buf.length > MAX_FILE_SIZE || buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// options.exclude — шаблоны из --exclude, дополняют .vibehoundignore
// options.staged  — проверять только файлы из индекса (для pre-commit хука)
export function scanProject(root, { exclude = [], staged = false } = {}) {
  root = path.resolve(root);
  let { mode, files } = listFiles(root);
  if (staged && mode !== 'git') {
    throw new ScanError('stagedNotGit');
  }
  const stagedSet = staged ? new Set(listStagedFiles(root)) : null;
  if (staged) mode = 'staged';
  const findings = [];
  const notes = [];
  const sqlFiles = [];
  let scanned = 0;
  let excluded = 0;

  const isExcluded = compileIgnore([...readIgnoreFiles(root, readText), ...exclude]);
  const isSql = (rel) => rel.toLowerCase().endsWith('.sql');

  for (const rel of files) {
    if (shouldSkip(rel)) continue;
    if (isExcluded(rel)) { if (!stagedSet || stagedSet.has(rel)) excluded++; continue; }
    const isStaged = !stagedSet || stagedSet.has(rel);
    // В режиме --staged остальные SQL-файлы читаем только как контекст:
    // RLS может быть включён в старой миграции.
    if (!isStaged && !isSql(rel)) continue;
    const base = path.basename(rel);

    const envFile = isEnvFile(base);
    if (envFile && mode !== 'folder' && isStaged) findings.push(makeFinding(envFileRule, rel, null));

    const content = stagedSet?.has(rel) ? readStaged(root, rel) : readText(path.join(root, rel));
    if (content === null) continue;
    if (isSql(rel)) sqlFiles.push({ rel, content });
    if (!isStaged) continue;
    scanned++;

    if (envFile && mode === 'folder') {
      scanEnvFile(rel, content, findings);
      continue;
    }
    scanSecrets(rel, content, findings);
  }

  // В --staged проверяем только коммит, игнорируемые файлы туда не входят
  if (mode === 'git') {
    for (const rel of listIgnoredEnvFiles(root)) {
      if (shouldSkip(rel) || isExcluded(rel)) continue;
      const content = readText(path.join(root, rel));
      if (content === null) continue;
      scanned++;
      scanEnvFile(rel, content, findings);
    }
  }

  scanSqlFiles(sqlFiles, findings);

  // .gitignore
  const gitignore = readText(path.join(root, '.gitignore'));
  const protectsEnv = gitignore && gitignore.split('\n').some((l) => /^\s*\/?\.env/.test(l));
  if (!protectsEnv) {
    findings.push(makeFinding(gitignoreRule, '.gitignore', null, {
      snippetKey: gitignore === null ? 'gitignoreMissing' : 'gitignoreNoEnv',
    }));
  }

  // В режиме --staged сообщаем только о файлах из коммита
  // (.gitignore — только если он сам в коммите).
  let result = findings;
  if (stagedSet) {
    result = findings.filter((f) => stagedSet.has(f.file));
    notes.push(stagedSet.size === 0
      ? { key: 'stagedEmpty' }
      : { key: 'stagedOnly', params: { count: scanned } });
  }

  if (mode === 'folder') {
    notes.push({ key: 'folderMode' });
  }
  if (excluded > 0) {
    notes.push({ key: 'excluded', params: { count: excluded } });
  }
  if (sqlFiles.length === 0 && !stagedSet) {
    notes.push({ key: 'noSql' });
  }

  result.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { root, mode, filesScanned: scanned, findings: result, notes, notChecked: [...NOT_CHECKED] };
}
