#!/usr/bin/env node
// Usage: leakhound <path> [--json] [--staged | --history] [--exclude <pattern>]... [--lang en|ru]
//        leakhound install-hook [path] [--force] [--lang en|ru]
//        leakhound install-skill [path] [--user | --cursor] [--force]
//        leakhound mcp [--lang en|ru]          (MCP server over stdio)
//        leakhound --help | --version
// Language: --lang → LEAKHOUND_LANG → LC_ALL / LC_MESSAGES / LANG → system locale → English.
import fs from 'node:fs';
import { printReport } from './report.js';
import { installHook } from './hook.js';
import { scanRaw, hasSeriousFindings } from './api.js';
import { detectLang, createT, ScanError, localizeResult } from './i18n/index.js';

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

// --help / --version win over any command, so `leakhound mcp --help` does not start the server
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (argv.some((a) => a === '--help' || a === '-h')) {
  console.log(t('cli.help', { version: VERSION }));
  process.exit(0);
}
if (argv.some((a) => a === '--version' || a === '-v')) {
  console.log(VERSION);
  process.exit(0);
}

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

// MCP server over stdio — nothing else may be written to stdout
if (argv[0] === 'mcp') {
  const unknown = argv.slice(1).find((a, i, rest) => a.startsWith('--') && a !== '--lang' && !a.startsWith('--lang=') && rest[i - 1] !== '--lang');
  if (unknown) fail(new ScanError('unknownFlag', { flag: unknown }));
  const { serveStdio } = await import('./mcp.js');
  await serveStdio({ lang });
  process.exit(0);
}

if (argv[0] === 'install-skill') {
  const rest = argv.slice(1);
  const where = rest.includes('--user') ? 'user' : rest.includes('--cursor') ? 'cursor' : 'project';
  const unknown = rest.find((a, i) => a.startsWith('--') && !['--user', '--cursor', '--force', '--lang'].includes(a) && !a.startsWith('--lang=') && rest[i - 1] !== '--lang');
  if (unknown) fail(new ScanError('unknownFlag', { flag: unknown }));
  const target = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--lang') || '.';
  try {
    const { installSkill } = await import('./skill.js');
    const { file, overwritten, removedLegacy } = installSkill({ where, root: target, force: rest.includes('--force') });
    console.log(t(overwritten ? 'cli.skillUpdated' : 'cli.skillInstalled', { path: file }));
    if (removedLegacy) console.log(t('cli.skillLegacyRemoved', { path: removedLegacy }));
    console.log(t(where === 'cursor' ? 'cli.skillExplainCursor' : 'cli.skillExplain'));
    process.exit(0);
  } catch (e) {
    fail(e);
  }
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
  result = await scanRaw(opts.target, { staged: opts.staged, history: opts.history, exclude: opts.exclude });
} catch (e) {
  fail(e);
}

if (opts.json) {
  console.log(JSON.stringify(localizeResult(result, lang), null, 2));
} else {
  printReport(result, lang);
}

// Exit code 1 on critical/high findings — handy for CI and the pre-commit hook
process.exit(hasSeriousFindings(result) ? 1 : 0);
