// Detector: secrets that were removed from files but remain in git history.
// Runs the same deterministic rules over lines ADDED in every commit
// (`git log -p --all`). A key that ever reached a commit must be rotated:
// deleting it from the file does not remove it from the repository.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { secretRules, jwtRegex, serviceRoleRule, KNOWN_EXAMPLE_KEYS, SEVERITY_ORDER } from '../rules.js';
import { listFiles, shouldSkip, readText, mask, isEnvFile, decodeJwtPayload, makeFinding } from '../scan.js';
import { IGNORE_FILE, parseIgnoreFile, compileIgnore } from '../ignore.js';

export const historyEnvRule = {
  id: 'env-file-in-history',
  title: 'Файл .env был в коммите и остался в истории git',
  severity: 'high',
  why: 'Файл удалён из репозитория, но его содержимое по-прежнему лежит в старом коммите. Любой, у кого есть доступ к репозиторию, может его достать.',
  fix: 'Считай все ключи из этого файла утёкшими: перевыпусти каждый из них. Удаления файла недостаточно.',
};

const HISTORY_FIX = 'Перевыпусти ключ (старый отзови) — это главное, удаления из файла недостаточно. '
  + 'Переписывать историю (git filter-repo, BFG) имеет смысл только ПОСЛЕ смены ключа: '
  + 'если репозиторий уже кто-то клонировал или он был публичным, старый ключ всё равно мог утечь.';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

// All secrets in a piece of text: [{ rule, value, index }]
export function findSecrets(text) {
  const out = [];
  const seen = new Set();
  for (const rule of secretRules) {
    for (const m of text.matchAll(rule.regex)) {
      if (KNOWN_EXAMPLE_KEYS.has(m[0]) || seen.has(m.index)) continue;
      seen.add(m.index);
      out.push({ rule, value: m[0], index: m.index });
    }
  }
  for (const m of text.matchAll(jwtRegex)) {
    if (decodeJwtPayload(m[0])?.role === 'service_role') out.push({ rule: serviceRoleRule, value: m[0], index: m.index });
  }
  return out;
}

const maskLine = (line, value) => {
  const s = line.split(value).join(mask(value)).trim();
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
};

function assertGitRepo(root) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
  } catch {
    throw new Error('Режим --history работает только внутри git-репозитория.');
  }
}

// Streams `git log -p` and calls onAdded(file, lineNo, text, commit) for every added line,
// onNewFile(file, commit) for every file creation.
async function walkHistory(root, { onAdded, onNewFile }) {
  const SEP = '\x01';
  const git = spawn('git', [
    '-c', 'core.quotePath=false', 'log', '--all', '-p', '--no-color', '--no-ext-diff',
    '--unified=0', '--relative', `--format=${SEP}%H%x00%aI%x00%s`,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  git.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => git.on('close', resolve));

  let commit = null;
  let commits = 0;
  let file = null;
  let isNew = false;
  let inHunk = false;
  let lineNo = 0;

  for await (const line of readline.createInterface({ input: git.stdout, crlfDelay: Infinity })) {
    if (line.startsWith(SEP)) {
      const [h, date, subject] = line.slice(1).split('\0');
      commit = { hash: h, short: h.slice(0, 7), date: date.slice(0, 10), subject };
      commits++;
      file = null; inHunk = false;
    } else if (line.startsWith('diff --git ')) {
      file = null; isNew = false; inHunk = false;
    } else if (!inHunk && line.startsWith('new file mode')) {
      isNew = true;
    } else if (!inHunk && line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      if (file && isNew) onNewFile(file, commit);
    } else if (line.startsWith('@@')) {
      inHunk = true;
      lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 1);
    } else if (inHunk && file && line[0] === '+') {
      onAdded(file, lineNo, line.slice(1), commit);
      lineNo++;
    }
  }

  const code = await exited;
  if (code !== 0) throw new Error(`git log завершился с ошибкой: ${stderr.trim()}`);
  return commits;
}

export async function scanHistory(root, { exclude = [] } = {}) {
  root = path.resolve(root);
  assertGitRepo(root);

  const ignoreText = readText(path.join(root, IGNORE_FILE));
  const isExcluded = compileIgnore([...(ignoreText ? parseIgnoreFile(ignoreText) : []), ...exclude]);
  const skip = (rel) => shouldSkip(rel) || isExcluded(rel);

  // Secrets still present in current files are reported by the regular scan
  const { files } = listFiles(root);
  const tracked = new Set(files.map((f) => f.replace(/\\/g, '/')));
  const current = new Set();
  for (const rel of files) {
    if (skip(rel)) continue;
    const content = readText(path.join(root, rel));
    if (content) for (const s of findSecrets(content)) current.add(hash(s.value));
  }

  // git log goes newest → oldest, so the last write wins = the commit that introduced it
  const secrets = new Map();
  const envFiles = new Map();
  const commits = await walkHistory(root, {
    onAdded(file, lineNo, text, commit) {
      if (skip(file)) return;
      for (const s of findSecrets(text)) {
        const key = hash(s.value);
        if (current.has(key)) continue;
        secrets.set(key, { ...s, file, lineNo, commit, snippet: maskLine(text, s.value) });
      }
    },
    onNewFile(file, commit) {
      if (skip(file) || !isEnvFile(path.posix.basename(file)) || tracked.has(file)) return;
      envFiles.set(file, commit);
    },
  });

  const findings = [];
  for (const s of secrets.values()) {
    findings.push({
      ...makeFinding(s.rule, s.file, s.lineNo, {
        snippet: s.snippet,
        why: `${s.rule.why} Ключ уже удалён из файлов, но остался в истории git: его добавили в коммите ${s.commit.short} (${s.commit.date}).`,
        fix: HISTORY_FIX,
        commit: s.commit,
      }),
      title: `${s.rule.title} — в истории git`,
      source: 'history',
    });
  }
  for (const [file, commit] of envFiles) {
    findings.push({ ...makeFinding(historyEnvRule, file, null, { commit }), source: 'history' });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { findings, commitsScanned: commits };
}
