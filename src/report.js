// Terminal output. Takes a raw (language-neutral) result: findings of the same kind are
// grouped — title, "why" and "fix" once, then the list of places. --json is not grouped.
import { createT, groupFindings, localizeResult } from './i18n/index.js';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', green: '\x1b[32m', magenta: '\x1b[35m',
};

const SEVERITY_COLOR = { critical: C.magenta, high: C.red, medium: C.yellow, low: C.blue };

export function printReport(raw, lang) {
  const t = createT(lang);
  const { root, mode, filesScanned, findings } = raw;
  const { notes, notChecked } = localizeResult(raw, lang);
  const label = (s) => `${C.bold}${SEVERITY_COLOR[s]}${t(`severity.${s}`)}${C.reset}`;
  const loc = (x) => (x.line ? `${x.file}:${x.line}` : x.file);
  const clientSide = (x) => (x.clientSide ? `  ⚠️  ${t('report.clientSide')}` : '');
  const commit = (c) => t('report.commit', { commit: c.short, date: c.date, subject: c.subject });

  console.log(`\n${C.bold}🔍 leakhound${C.reset}  ${C.dim}${root}${C.reset}`);
  console.log(`${C.dim}${t('report.mode')}: ${t(`report.modes.${mode}`)} · ${t('report.filesScanned')}: ${filesScanned}${C.reset}\n`);

  if (findings.length === 0) {
    console.log(`${C.green}${C.bold}${t('report.noProblems')}${C.reset}\n`);
  }

  groupFindings(findings, t).forEach((g, i) => {
    const times = g.count > 1 ? `  ${C.dim}×${g.count}${C.reset}` : '';
    console.log(`${C.bold}${i + 1}.${C.reset} [${label(g.severity)}] ${C.bold}${g.title}${C.reset}${times}`);

    if (g.count === 1) {
      const [x] = g.items;
      console.log(`   ${C.dim}📄 ${loc(x)}${clientSide(x)}${C.reset}`);
      if (x.commit) console.log(`   ${C.dim}🕓 ${commit(x.commit)}${C.reset}`);
      if (x.snippet) console.log(`   ${C.dim}│${C.reset} ${x.snippet}`);
    }
    console.log(`   ${C.bold}${t('report.why')}${C.reset} ${g.why}`);
    console.log(`   ${C.bold}${t('report.fix')}${C.reset} ${g.fix.split('\n').join('\n   ')}`);

    if (g.count > 1) {
      console.log(`   ${C.bold}${t('report.where', { count: g.count })}${C.reset}`);
      for (const x of g.items) {
        const detail = x.snippet ? ` ${C.dim}—${C.reset} ${x.snippet}` : '';
        console.log(`   ${C.dim}📄 ${loc(x)}${C.reset}${detail}${C.dim}${clientSide(x)}${C.reset}`);
        if (x.commit) console.log(`      ${C.dim}🕓 ${commit(x.commit)}${C.reset}`);
      }
    }
    console.log();
  });

  const count = (s) => findings.filter((f) => f.severity === s).length;
  const counts = t('report.counts', {
    critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low'),
  });
  console.log(`${C.bold}${t('report.total')}${C.reset} ${counts}`);
  for (const n of notes) console.log(`${C.dim}ℹ️  ${n}${C.reset}`);

  // Hidden in hook mode to keep the output short — the list is shown on regular runs
  if (mode !== 'staged' && notChecked.length) {
    console.log(`\n${C.bold}${t('report.notCheckedTitle')}${C.reset} ${C.dim}${t('report.notCheckedSubtitle')}${C.reset}`);
    for (const { what, hint } of notChecked) console.log(`${C.dim}  • ${what} — ${hint}${C.reset}`);
  }
  console.log();
}
