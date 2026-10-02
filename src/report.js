// Красивый вывод результатов в терминал
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', green: '\x1b[32m', magenta: '\x1b[35m',
};

const LABEL = {
  critical: `${C.bold}${C.magenta}КРИТИЧНО${C.reset}`,
  high: `${C.bold}${C.red}ВЫСОКИЙ${C.reset}`,
  medium: `${C.bold}${C.yellow}СРЕДНИЙ${C.reset}`,
  low: `${C.bold}${C.blue}НИЗКИЙ${C.reset}`,
};

const MODE_LABEL = { git: 'git-репозиторий', staged: 'только файлы коммита (--staged)', folder: 'обычная папка' };

export function printReport(result) {
  const { root, mode, filesScanned, findings, notes } = result;
  console.log(`\n${C.bold}🔍 Vibe Scanner${C.reset}  ${C.dim}${root}${C.reset}`);
  console.log(`${C.dim}Режим: ${MODE_LABEL[mode]} · проверено файлов: ${filesScanned}${C.reset}\n`);

  if (findings.length === 0) {
    console.log(`${C.green}${C.bold}✅ Проблем не найдено.${C.reset}\n`);
  }

  findings.forEach((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`${C.bold}${i + 1}.${C.reset} [${LABEL[f.severity]}] ${C.bold}${f.title}${C.reset}`);
    console.log(`   ${C.dim}📄 ${loc}${f.clientSide ? '  ⚠️  похоже на клиентский файл — виден в браузере' : ''}${C.reset}`);
    if (f.snippet) console.log(`   ${C.dim}│${C.reset} ${f.snippet}`);
    console.log(`   ${C.bold}Почему опасно:${C.reset} ${f.why}`);
    console.log(`   ${C.bold}Как исправить:${C.reset} ${f.fix.split('\n').join('\n   ')}\n`);
  });

  const count = (s) => findings.filter((f) => f.severity === s).length;
  console.log(`${C.bold}Итого:${C.reset} ${count('critical')} критичных · ${count('high')} высоких · ${count('medium')} средних · ${count('low')} низких`);
  for (const n of notes) console.log(`${C.dim}ℹ️  ${n}${C.reset}`);

  // В режиме хука не засоряем вывод — список виден при обычном запуске
  if (mode !== 'staged' && result.notChecked?.length) {
    console.log(`\n${C.bold}Что сканер НЕ проверяет${C.reset} ${C.dim}(«проблем не найдено» ≠ «проект безопасен»):${C.reset}`);
    for (const { what, hint } of result.notChecked) console.log(`${C.dim}  • ${what} — ${hint}${C.reset}`);
  }
  console.log();
}
