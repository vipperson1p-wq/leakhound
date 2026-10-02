#!/usr/bin/env node
// Запуск: node src/index.js <путь-к-проекту> [--json] [--staged] [--exclude <шаблон>]...
import { scanProject } from './scan.js';
import { printReport } from './report.js';

function parseArgs(argv) {
  const opts = { target: '.', json: false, staged: false, exclude: [] };
  let targetSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--staged') opts.staged = true;
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

const opts = parseArgs(process.argv.slice(2));
let result;
try {
  result = scanProject(opts.target, { exclude: opts.exclude, staged: opts.staged });
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
