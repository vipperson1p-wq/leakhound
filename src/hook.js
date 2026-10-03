// Установка pre-commit хука: перед каждым коммитом запускается
// `vibe-scanner --staged`, при critical/high коммит блокируется.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createT, ScanError, DEFAULT_LANG } from './i18n/index.js';

export const HOOK_MARKER = '# vibe-scanner pre-commit hook';
export const PACKAGE_NAME = 'vibecode-scanner';
const CLI_PATH = fileURLToPath(new URL('./index.js', import.meta.url));
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version;

// Запущен ли сканер из npm-пакета (npx, npm i), а не из клона репозитория
const isInstalledPackage = (cliPath) => /[\\/]node_modules[\\/]/.test(cliPath);

// Порядок запуска сканера в хуке:
//   1. пакет, установленный в проект (node_modules/.bin) — быстро и без сети;
//   2. исходники, если хук ставили из клона репозитория;
//   3. npx с закреплённой версией — не тянем новую непроверенную версию на каждый коммит.
// Если ничего не доступно — предупреждаем и пропускаем коммит, а не ломаем все коммиты.
// Hook texts go inside double-quoted echo — characters the shell would interpret are not allowed
const SHELL_UNSAFE = /["$`\\]/;
export function hookMessages(lang) {
  const t = createT(lang);
  const keys = ['installedBy', 'notFound', 'install', 'blocked', 'blockedFix1', 'blockedFix2', 'npmError1', 'npmError2'];
  const m = Object.fromEntries(keys.map((k) => [k, t(`hook.${k}`, { package: PACKAGE_NAME })]));
  for (const [k, v] of Object.entries(m)) {
    if (SHELL_UNSAFE.test(v)) throw new Error(`hook.${k} (${lang}) contains a shell-unsafe character`);
  }
  return m;
}

function hookScript({ cliPath, source, lang }) {
  const sourcePath = source ? cliPath.replace(/\\/g, '/') : '';
  const m = hookMessages(lang);
  const args = `--staged --lang ${lang}`;
  return `#!/bin/sh
${HOOK_MARKER}
# ${m.installedBy}

SOURCE="${sourcePath}"
NPX_PACKAGE="${source ? '' : `${PACKAGE_NAME}@${PACKAGE_VERSION}`}"

if [ -x "./node_modules/.bin/vibe-scanner" ]; then
  ./node_modules/.bin/vibe-scanner ${args}
elif [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  node "$SOURCE" ${args}
elif [ -n "$NPX_PACKAGE" ] && command -v npx >/dev/null 2>&1; then
  npx --yes "$NPX_PACKAGE" ${args}
else
  echo "${m.notFound}" >&2
  echo "${m.install}" >&2
  exit 0
fi
status=$?

if [ $status -eq 1 ]; then
  echo "" >&2
  echo "${m.blocked}" >&2
  echo "${m.blockedFix1}" >&2
  echo "${m.blockedFix2}" >&2
  echo "${m.npmError1}" >&2
  echo "${m.npmError2}" >&2
fi
exit $status
`;
}

// Возвращает { hookPath, backupPath?, runner }
// options.source — запускать из исходников (по умолчанию: если сканер не из node_modules)
// options.lang — язык сообщений хука и отчёта при коммите
export function installHook(root, { force = false, cliPath = CLI_PATH, source, lang = DEFAULT_LANG } = {}) {
  root = path.resolve(root);
  source ??= !isInstalledPackage(cliPath);
  let hooksDir;
  try {
    hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    throw new ScanError('hookNotGit');
  }
  hooksDir = path.resolve(root, hooksDir);
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-commit');
  let backupPath;
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) {
      if (!force) {
        throw new ScanError('hookExists', { path: hookPath });
      }
      backupPath = `${hookPath}.backup`;
      fs.copyFileSync(hookPath, backupPath);
    }
  }

  fs.writeFileSync(hookPath, hookScript({ cliPath, source, lang }), { mode: 0o755 });
  fs.chmodSync(hookPath, 0o755);
  const runner = source ? `node ${cliPath}` : `npx ${PACKAGE_NAME}@${PACKAGE_VERSION}`;
  return { hookPath, backupPath, runner };
}
