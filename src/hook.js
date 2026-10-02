// Установка pre-commit хука: перед каждым коммитом запускается
// `vibe-scanner --staged`, при critical/high коммит блокируется.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_MARKER = '# vibe-scanner pre-commit hook';
const CLI_PATH = fileURLToPath(new URL('./index.js', import.meta.url));

function hookScript(cliPath) {
  const cli = cliPath.replace(/\\/g, '/');
  return `#!/bin/sh
${HOOK_MARKER}
# Установлен командой: vibe-scanner install-hook

SCANNER="${cli}"
if [ ! -f "$SCANNER" ]; then
  echo "vibe-scanner: не найден $SCANNER — проверка пропущена. Переустанови хук: vibe-scanner install-hook" >&2
  exit 0
fi

node "$SCANNER" --staged
status=$?
if [ $status -eq 1 ]; then
  echo "" >&2
  echo "⛔ Коммит заблокирован: vibe-scanner нашёл критичные проблемы (см. выше)." >&2
  echo "   Исправь их и снова сделай git add. Если это ложное срабатывание —" >&2
  echo "   добавь путь в .vibescanignore." >&2
fi
exit $status
`;
}

// Возвращает { hookPath, backupPath? }
export function installHook(root, { force = false, cliPath = CLI_PATH } = {}) {
  root = path.resolve(root);
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

  fs.writeFileSync(hookPath, hookScript(cliPath), { mode: 0o755 });
  fs.chmodSync(hookPath, 0o755);
  return { hookPath, backupPath };
}
