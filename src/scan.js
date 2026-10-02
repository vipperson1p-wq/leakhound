import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  secretRules, jwtRegex, serviceRoleRule, publicEnvRule, genericSecretRule,
  envFileRule, gitignoreRule, rlsMissingRule, permissivePolicyRule, SEVERITY_ORDER,
} from './rules.js';

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
function listFiles(root) {
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

function shouldSkip(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (IGNORED_FILES.has(base)) return true;
  if (BINARY_EXT.has(path.extname(base).toLowerCase())) return true;
  return false;
}

function readText(abs) {
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

const isEnvFile = (base) => /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base);

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

const mask = (secret) => `${secret.slice(0, 6)}…****`;

function snippet(content, index, secret) {
  const start = content.lastIndexOf('\n', index) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  let line = content.slice(start, end);
  if (secret) line = line.split(secret).join(mask(secret));
  line = line.trim();
  return line.length > 160 ? line.slice(0, 157) + '...' : line;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function makeFinding(rule, file, line, extra = {}) {
  return {
    ruleId: rule.id,
    title: rule.title,
    severity: extra.severity || rule.severity,
    file,
    line,
    snippet: extra.snippet || null,
    clientSide: extra.clientSide ?? null,
    why: extra.why || rule.why,
    fix: rule.fix,
  };
}

// ---------- Проверки отдельных файлов ----------

function scanSecrets(rel, content, findings) {
  const client = isClientFile(rel, content);
  const reported = new Set(); // чтобы не дублировать одно и то же место

  for (const rule of secretRules) {
    for (const m of content.matchAll(rule.regex)) {
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
}

// SQL-проверки собираем по всем файлам сразу: таблица может быть создана
// в одной миграции, а RLS включён в другой.
const normTable = (name) => name.replace(/"/g, '').toLowerCase().replace(/^public\./, '');

function scanSqlFiles(sqlFiles, findings) {
  const created = []; // { table, file, line }
  const rlsEnabled = new Set();

  for (const { rel, content } of sqlFiles) {
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
    for (const m of content.matchAll(createRe)) {
      const raw = m[1].replace(/"/g, '').toLowerCase();
      if (raw.includes('.') && !raw.startsWith('public.')) continue; // auth., private. и т.п.
      created.push({ table: normTable(m[1]), file: rel, line: lineOf(content, m.index) });
    }

    const rlsRe = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+enable\s+row\s+level\s+security/gi;
    for (const m of content.matchAll(rlsRe)) rlsEnabled.add(normTable(m[1]));

    for (const m of content.matchAll(/create\s+policy[^;]*;/gi)) {
      const stmt = m[0];
      if (!/(using|with\s+check)\s*\(\s*true\s*\)/i.test(stmt)) continue;
      const selectOnly = /\bfor\s+select\b/i.test(stmt);
      findings.push(makeFinding(permissivePolicyRule, rel, lineOf(content, m.index), {
        severity: selectOnly ? 'low' : 'high',
        why: selectOnly
          ? 'Любой (даже без входа) может читать все строки этой таблицы. Нормально для публичных данных (посты блога), опасно для личных (профили, сообщения).'
          : undefined,
        snippet: stmt.replace(/\s+/g, ' ').slice(0, 160),
      }));
    }
  }

  for (const t of created) {
    if (!rlsEnabled.has(t.table)) {
      findings.push(makeFinding(rlsMissingRule, t.file, t.line, {
        snippet: `CREATE TABLE ${t.table} … (RLS нигде не включён)`,
      }));
    }
  }
}

// ---------- Главная функция ----------

export function scanProject(root) {
  root = path.resolve(root);
  const { mode, files } = listFiles(root);
  const findings = [];
  const notes = [];
  const sqlFiles = [];
  let scanned = 0;

  for (const rel of files) {
    if (shouldSkip(rel)) continue;
    const base = path.basename(rel);

    if (isEnvFile(base)) {
      if (mode === 'git') {
        findings.push(makeFinding(envFileRule, rel, null));
      } else {
        continue; // в обычной папке .env — это нормально, проверяем только .gitignore
      }
    }

    const content = readText(path.join(root, rel));
    if (content === null) continue;
    scanned++;

    scanSecrets(rel, content, findings);
    if (rel.toLowerCase().endsWith('.sql')) sqlFiles.push({ rel, content });
  }

  scanSqlFiles(sqlFiles, findings);

  // .gitignore
  const gitignore = readText(path.join(root, '.gitignore'));
  const protectsEnv = gitignore && gitignore.split('\n').some((l) => /^\s*\/?\.env/.test(l));
  if (!protectsEnv) {
    findings.push(makeFinding(gitignoreRule, '.gitignore', null, {
      snippet: gitignore === null ? 'Файл .gitignore отсутствует' : 'Нет строки для .env',
    }));
  }

  if (mode === 'folder') {
    notes.push('Папка не является git-репозиторием: проверены все файлы, а .env-файлы пропущены.');
  }
  if (sqlFiles.length === 0) {
    notes.push('SQL-миграции не найдены: проверка RLS не выполнялась. Для Supabase это обычно папка supabase/migrations.');
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { root, mode, filesScanned: scanned, findings, notes };
}
