// Установка pre-commit хука: перед каждым коммитом запускается
// `vibe-scanner --staged`, при critical/high коммит блокируется.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
function hookScript({ cliPath, source }) {
  const sourcePath = source ? cliPath.replace(/\\/g, '/') : '';
  return `#!/bin/sh
${HOOK_MARKER}
# Установлен командой: vibe-scanner install-hook

SOURCE="${sourcePath}"
NPX_PACKAGE="${source ? '' : `${PACKAGE_NAME}@${PACKAGE_VERSION}`}"

if [ -x "./node_modules/.bin/vibe-scanner" ]; then
  ./node_modules/.bin/vibe-scanner --staged
elif [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  node "$SOURCE" --staged
elif [ -n "$NPX_PACKAGE" ] && command -v npx >/dev/null 2>&1; then
  npx --yes "$NPX_PACKAGE" --staged
else
  echo "vibe-scanner: сканер не найден — проверка пропущена." >&2
  echo "Установи его в проект: npm install -D ${PACKAGE_NAME}" >&2
  exit 0
fi
status=$?

if [ $status -eq 1 ]; then
  echo "" >&2
  echo "⛔ Коммит заблокирован: vibe-scanner нашёл критичные проблемы (см. выше)." >&2
  echo "   Исправь их и снова сделай git add. Если это ложное срабатывание —" >&2
  echo "   добавь путь в .vibescanignore." >&2
  echo "   (Если выше ошибка npm, а не находки — проверь интернет или установи пакет:" >&2
  echo "   npm install -D ${PACKAGE_NAME})" >&2
fi
exit $status
`;
}

// Возвращает { hookPath, backupPath?, runner }
// options.source — запускать из исходников (по умолчанию: если сканер не из node_modules)
export function installHook(root, { force = false, cliPath = CLI_PATH, source } = {}) {
  root = path.resolve(root);
  source ??= !isInstalledPackage(cliPath);
  let hooksDir;
  try {
    hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    throw new Error('Это не git-репозиторий. Сначала выполни git init.');
  }
  hooksDir = path.resolve(root, hooksDir);
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-commit');
  let backupPath;
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) {
      if (!force) {
        throw new Error(`Уже есть другой pre-commit хук: ${hookPath}\nЗапусти с --force: старый хук сохранится в pre-commit.backup.`);
      }
      backupPath = `${hookPath}.backup`;
      fs.copyFileSync(hookPath, backupPath);
    }
  }

  fs.writeFileSync(hookPath, hookScript({ cliPath, source }), { mode: 0o755 });
  fs.chmodSync(hookPath, 0o755);
  const runner = source ? `node ${cliPath}` : `npx ${PACKAGE_NAME}@${PACKAGE_VERSION}`;
  return { hookPath, backupPath, runner };
}
