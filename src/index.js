#!/usr/bin/env node
// Запуск: node src/index.js <путь-к-проекту> [--json] [--staged | --history] [--exclude <шаблон>]...
//         node src/index.js install-hook [путь] [--force]
import { scanProject } from './scan.js';
import { printReport } from './report.js';
import { installHook } from './hook.js';
import { scanHistory } from './detectors/history.js';
import { SEVERITY_ORDER } from './rules.js';

function parseArgs(argv) {
  const opts = { target: '.', json: false, staged: false, history: false, exclude: [] };
  let targetSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--staged') opts.staged = true;
    else if (a === '--history') opts.history = true;
    else if (a === '--exclude') {
      const value = argv[++i];
      if (!value) fail('После --exclude нужен путь или шаблон, например: --exclude test-project/');
      opts.exclude.push(value);
    } else if (a.startsWith('--exclude=')) opts.exclude.push(a.slice('--exclude='.length));
    else if (a.startsWith('--')) fail(`Неизвестный флаг: ${a}`);
    else if (!targetSet) { opts.target = a; targetSet = true; }
    else fail(`Лишний аргумент: ${a}`);
  }
  return opts;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const argv = process.argv.slice(2);

// vibe-scanner install-hook [путь] [--force]
if (argv[0] === 'install-hook') {
  const rest = argv.slice(1);
  const unknown = rest.find((a) => a.startsWith('--') && a !== '--force');
  if (unknown) fail(`Неизвестный флаг: ${unknown}`);
  try {
    const { hookPath, backupPath, runner } = installHook(rest.find((a) => !a.startsWith('--')) || '.', {
      force: rest.includes('--force'),
    });
    if (backupPath) console.log(`Старый хук сохранён: ${backupPath}`);
    console.log(`✅ pre-commit хук установлен: ${hookPath}`);
    console.log('Теперь перед каждым коммитом проверяются добавленные файлы. Коммит блокируется при критичных и высоких проблемах.');
    console.log(`Запуск сканера: node_modules/.bin/vibe-scanner, если пакет установлен в проект, иначе — ${runner}.`);
    process.exit(0);
  } catch (e) {
    fail(e.message);
  }
}

const opts = parseArgs(argv);
if (opts.staged && opts.history) fail('--staged и --history нельзя использовать вместе.');
let result;
try {
  result = scanProject(opts.target, { exclude: opts.exclude, staged: opts.staged });
  if (opts.history) {
    const h = await scanHistory(opts.target, { exclude: opts.exclude });
    result.findings.push(...h.findings);
    result.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    result.historyCommitsScanned = h.commitsScanned;
    result.notChecked = result.notChecked.filter((x) => x.what !== 'Историю git');
    result.notes.push(h.findings.length
      ? `Проверена история git: ${h.commitsScanned} коммитов. Найдено в истории: ${h.findings.length}.`
      : `Проверена история git: ${h.commitsScanned} коммитов — удалённых ключей в истории не найдено.`);
  }
} catch (e) {
  fail(e.message);
}

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printReport(result);
}

// Код выхода 1, если есть серьёзные проблемы — пригодится для CI
const serious = result.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
process.exit(serious ? 1 : 0);
