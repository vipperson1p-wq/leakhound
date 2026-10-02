#!/usr/bin/env node
// Запуск: node src/index.js <путь-к-проекту> [--json]
import { scanProject } from './scan.js';
import { printReport } from './report.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--')) || '.';

const result = scanProject(target);

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printReport(result);
}

// Код выхода 1, если есть серьёзные проблемы — пригодится для CI
const serious = result.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
process.exit(serious ? 1 : 0);
