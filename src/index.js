#!/usr/bin/env node
// Usage: vibe-scanner <path> [--json] [--staged | --history] [--exclude <pattern>]... [--lang en|ru]
//        vibe-scanner install-hook [path] [--force] [--lang en|ru]
// Language: --lang → VIBESCAN_LANG → LC_ALL / LC_MESSAGES / LANG → system locale → English.
import { printReport } from './report.js';
import { installHook } from './hook.js';
import { scan, hasSeriousFindings } from './api.js';
import { detectLang, createT, ScanError } from './i18n/index.js';

const argv = process.argv.slice(2);

// --lang is read before everything else, so even argument errors are in the right language
function pickLang(args) {
  let flag;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang') flag = args[i + 1] ?? '';
    else if (args[i].startsWith('--lang=')) flag = args[i].slice('--lang='.length);
  }
  if (flag === '') return { lang: detectLang(), error: new ScanError('langValue') };
  try {
    return { lang: detectLang({ flag }) };
  } catch (e) {
    return { lang: detectLang(), error: e };
  }
}

const { lang, error: langError } = pickLang(argv);
const t = createT(lang);

function fail(e) {
  console.error(e instanceof ScanError ? t(`errors.${e.key}`, e.params) : e.message);
  process.exit(2);
}
if (langError) fail(langError);

function parseArgs(args) {
  const opts = { target: '.', json: false, staged: false, history: false, exclude: [] };
  let targetSet = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--staged') opts.staged = true;
    else if (a === '--history') opts.history = true;
    else if (a === '--lang') i++;
    else if (a.startsWith('--lang=')) continue;
    else if (a === '--exclude') {
      const value = args[++i];
      if (!value) fail(new ScanError('excludeValue'));
      opts.exclude.push(value);
    } else if (a.startsWith('--exclude=')) opts.exclude.push(a.slice('--exclude='.length));
    else if (a.startsWith('--')) fail(new ScanError('unknownFlag', { flag: a }));
    else if (!targetSet) { opts.target = a; targetSet = true; }
    else fail(new ScanError('extraArg', { arg: a }));
  }
  return opts;
}

if (argv[0] === 'install-hook') {
  const rest = argv.slice(1);
  let target = '.';
  let force = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') force = true;
    else if (a === '--lang') i++;
    else if (a.startsWith('--lang=')) continue;
    else if (a.startsWith('--')) fail(new ScanError('unknownFlag', { flag: a }));
    else target = a;
  }
  try {
    const { hookPath, backupPath, runner } = installHook(target, { force, lang });
    if (backupPath) console.log(t('cli.hookBackup', { path: backupPath }));
    console.log(t('cli.hookInstalled', { path: hookPath }));
    console.log(t('cli.hookExplain'));
    console.log(t('cli.hookRunner', { runner }));
    process.exit(0);
  } catch (e) {
    fail(e);
  }
}

const opts = parseArgs(argv);
let result;
try {
  result = await scan(opts.target, { lang, staged: opts.staged, history: opts.history, exclude: opts.exclude });
} catch (e) {
  fail(e);
}

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printReport(result, t);
}

// Exit code 1 on critical/high findings — handy for CI and the pre-commit hook
process.exit(hasSeriousFindings(result) ? 1 : 0);
