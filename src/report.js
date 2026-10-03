// Terminal output. Takes an already localized result (see i18n/localizeResult) and t() for labels.
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', green: '\x1b[32m', magenta: '\x1b[35m',
};

const SEVERITY_COLOR = { critical: C.magenta, high: C.red, medium: C.yellow, low: C.blue };

export function printReport(result, t) {
  const { root, mode, filesScanned, findings, notes } = result;
  const label = (s) => `${C.bold}${SEVERITY_COLOR[s]}${t(`severity.${s}`)}${C.reset}`;

  console.log(`\n${C.bold}🔍 Vibe Scanner${C.reset}  ${C.dim}${root}${C.reset}`);
  console.log(`${C.dim}${t('report.mode')}: ${t(`report.modes.${mode}`)} · ${t('report.filesScanned')}: ${filesScanned}${C.reset}\n`);

  if (findings.length === 0) {
    console.log(`${C.green}${C.bold}${t('report.noProblems')}${C.reset}\n`);
  }

  findings.forEach((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`${C.bold}${i + 1}.${C.reset} [${label(f.severity)}] ${C.bold}${f.title}${C.reset}`);
    console.log(`   ${C.dim}📄 ${loc}${f.clientSide ? `  ⚠️  ${t('report.clientSide')}` : ''}${C.reset}`);
    if (f.commit) {
      console.log(`   ${C.dim}🕓 ${t('report.commit', { commit: f.commit.short, date: f.commit.date, subject: f.commit.subject })}${C.reset}`);
    }
    if (f.snippet) console.log(`   ${C.dim}│${C.reset} ${f.snippet}`);
    console.log(`   ${C.bold}${t('report.why')}${C.reset} ${f.why}`);
    console.log(`   ${C.bold}${t('report.fix')}${C.reset} ${f.fix.split('\n').join('\n   ')}\n`);
  });

  const count = (s) => findings.filter((f) => f.severity === s).length;
  const counts = t('report.counts', {
    critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low'),
  });
  console.log(`${C.bold}${t('report.total')}${C.reset} ${counts}`);
  for (const n of notes) console.log(`${C.dim}ℹ️  ${n}${C.reset}`);

  // Hidden in hook mode to keep the output short — the list is shown on regular runs
  if (mode !== 'staged' && result.notChecked?.length) {
    console.log(`\n${C.bold}${t('report.notCheckedTitle')}${C.reset} ${C.dim}${t('report.notCheckedSubtitle')}${C.reset}`);
    for (const { what, hint } of result.notChecked) console.log(`${C.dim}  • ${what} — ${hint}${C.reset}`);
  }
  console.log();
}
