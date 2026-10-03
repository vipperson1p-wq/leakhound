import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';
import { createT, groupFindings } from '../src/i18n/index.js';
import { formatResult } from '../src/mcp.js';
import { scanRaw } from '../src/api.js';

const CLI = path.resolve('src/index.js');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, LEAKHOUND_LANG: '' } });

const unverified = (table, line) => ({
  ruleId: 'rls-unverified', severity: 'medium', file: 'm.sql', line, snippetKey: 'rlsUnverified', params: { table },
});
const commit = (n) => ({ hash: `${n}`.repeat(40).slice(0, 40), short: `${n}`.repeat(7), date: '2026-01-0' + n, subject: `c${n}` });

// A project where one rule fires several times
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-report-'));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase', 'migrations', '001.sql'), [
    'alter table public.reports add column a int;',
    'alter table public.profiles add column b int;',
    'alter table public.payments add column c int;',
    'create table public.notes (id int);',
  ].join('\n'));
  return dir;
}

describe('groupFindings', () => {
  const t = createT('en');

  test('same rule several times → one group, shared "why", places with table names', () => {
    const [g, ...rest] = groupFindings([unverified('reports', 3), unverified('profiles', 7), unverified('payments', 9)], t);
    assert.equal(rest.length, 0);
    assert.equal(g.count, 3);
    assert.equal(g.title, en.rules['rls-unverified'].title);
    assert.equal(g.why, en.rules['rls-unverified'].why_group);
    assert.deepEqual(g.items.map((x) => `${x.line} ${x.snippet}`), ['3 table reports', '7 table profiles', '9 table payments']);
  });

  test('a single finding keeps its specific "why" and full snippet', () => {
    const [g] = groupFindings([unverified('reports', 3)], t);
    assert.equal(g.count, 1);
    assert.match(g.why, /the table reports/);
    assert.match(g.items[0].snippet, /reports — no CREATE TABLE/);
  });

  test('different severity, variant or source are separate groups; order is kept', () => {
    const groups = groupFindings([
      { ruleId: 'permissive-policy', severity: 'high', file: 'a.sql', line: 1 },
      { ruleId: 'permissive-policy', severity: 'low', variant: 'selectOnly', file: 'a.sql', line: 2 },
      { ruleId: 'openai-key', severity: 'critical', file: 'a.ts', line: 1, snippet: 'k = "sk-pro…****"' },
      { ruleId: 'openai-key', severity: 'critical', file: 'b.ts', line: 1, source: 'history', commit: commit(1) },
      { ruleId: 'permissive-policy', severity: 'high', file: 'b.sql', line: 5 },
    ], t);
    assert.deepEqual(groups.map((g) => `${g.ruleId}/${g.severity}/${g.count}`), [
      'permissive-policy/high/2', 'permissive-policy/low/1', 'openai-key/critical/1', 'openai-key/critical/1',
    ]);
  });

  test('history group: generic "why", commit per place', () => {
    const [g] = groupFindings([
      { ruleId: 'openai-key', severity: 'critical', file: 'a.ts', line: 1, source: 'history', commit: commit(1) },
      { ruleId: 'openai-key', severity: 'critical', file: 'b.ts', line: 2, source: 'history', commit: commit(2) },
    ], createT('ru'));
    assert.equal(g.count, 2);
    assert.match(g.title, /в истории git/);
    assert.ok(g.why.includes(ru.history.whyGroup));
    assert.ok(!g.why.includes('1111111'), 'no single commit in the shared text');
    assert.deepEqual(g.items.map((x) => x.commit.short), ['1111111', '2222222']);
  });

  test('every "why" with parameters has a group version in both languages', () => {
    for (const dict of [en, ru]) {
      for (const [id, rule] of Object.entries(dict.rules)) {
        for (const [key, text] of Object.entries(rule)) {
          if (!key.startsWith('why') || key.endsWith('_group') || !/\{\w+\}/.test(text)) continue;
          assert.ok(rule[`${key}_group`], `${id}.${key}_group is missing`);
          assert.ok(!/\{\w+\}/.test(rule[`${key}_group`]), `${id}.${key}_group must not need parameters`);
        }
      }
    }
  });
});

describe('terminal report', () => {
  test('header says leakhound', () => {
    const out = strip(cli(['test-project', '--lang', 'en']).stdout);
    assert.match(out, /🔍 leakhound /);
    assert.ok(!/vibe-?scanner|vibecode/i.test(out), 'no name from before the rename');
  });

  test('repeated findings are grouped (en)', () => {
    const out = strip(cli([project(), '--lang', 'en']).stdout);
    // critical first (sorted by severity), then the medium group
    assert.match(out, /1\. \[CRITICAL\] Table without Row Level Security\n/);
    assert.match(out, /2\. \[MEDIUM\] RLS not verified: table created outside migrations {2}×3/);
    assert.equal(out.split('Why it is dangerous:').length - 1, 2, 'one "why" per group (unverified ×3 + rls-not-enabled)');
    const sql = String.raw`supabase[\\/]migrations[\\/]001\.sql`;
    assert.match(out, new RegExp(String.raw`Where \(3\):\n {3}📄 ${sql}:1 — table reports\n {3}📄 ${sql}:2 — table profiles\n {3}📄 ${sql}:3 — table payments`));
    assert.match(out, /Total: 1 critical · 0 high · 3 medium · 0 low/);
  });

  test('repeated findings are grouped (ru)', () => {
    const out = strip(cli([project(), '--lang', 'ru']).stdout);
    assert.match(out, /\[СРЕДНИЙ\] RLS не проверен: таблица создана вне миграций {2}×3/);
    assert.match(out, /Миграции работают с этими таблицами/);
    assert.match(out, /Где \(3\):\n {3}📄 supabase[\\/]migrations[\\/]001\.sql:1 — таблица reports/);
  });

  test('--json is not grouped: every finding is separate and complete', () => {
    const r = JSON.parse(cli([project(), '--json', '--lang', 'en']).stdout);
    const unv = r.findings.filter((f) => f.ruleId === 'rls-unverified');
    assert.equal(unv.length, 3);
    for (const f of unv) {
      assert.ok(f.title && f.fix);
      assert.match(f.why, new RegExp(`the table ${f.params.table}`));
      assert.equal(f.count, undefined);
      assert.equal(f.items, undefined);
    }
  });
});

describe('MCP report', () => {
  test('is grouped too, every place still wrapped as repository data', async () => {
    const raw = await scanRaw(project());
    const text = formatResult(raw, 'en', 'proj');
    assert.match(text, /^leakhound — proj/);
    assert.match(text, /RLS not verified: table created outside migrations \(rls-unverified\) ×3/);
    assert.equal(text.split('Why:').length - 1, 2);
    assert.equal((text.match(/<repository-data>table (reports|profiles|payments)<\/repository-data>/g) || []).length, 3);
  });
});
