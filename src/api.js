// Programmatic API — used by the CLI and meant for the future MCP server.
//
//   import { scan } from 'vibecode-scanner';
//   const result = await scan('.', { lang: 'en', history: true });
//
// Returns findings with texts in the chosen language. Secrets in snippets are always masked.
import { scanProject } from './scan.js';
import { scanHistory } from './detectors/history.js';
import { SEVERITY_ORDER } from './rules.js';
import { localizeResult, detectLang, ScanError, DEFAULT_LANG, LANGS } from './i18n/index.js';

export { detectLang, localizeResult, ScanError, LANGS, DEFAULT_LANG };

// Language-neutral result: ruleId + params, note keys, notChecked ids
export async function scanRaw(target = '.', { staged = false, history = false, exclude = [] } = {}) {
  if (staged && history) throw new ScanError('stagedWithHistory');
  const result = scanProject(target, { exclude, staged });
  if (history) {
    const h = await scanHistory(target, { exclude });
    result.findings.push(...h.findings);
    result.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    result.historyCommitsScanned = h.commitsScanned;
    result.notChecked = result.notChecked.filter((id) => id !== 'git-history');
    result.notes.push(h.findings.length
      ? { key: 'historyFound', params: { commits: h.commitsScanned, count: h.findings.length } }
      : { key: 'historyClean', params: { commits: h.commitsScanned } });
  }
  return result;
}

export async function scan(target = '.', { lang = DEFAULT_LANG, ...options } = {}) {
  return localizeResult(await scanRaw(target, options), lang);
}

// Exit-code rule shared by the CLI and the hook: critical/high block
export const hasSeriousFindings = (result) =>
  result.findings.some((f) => f.severity === 'critical' || f.severity === 'high');
