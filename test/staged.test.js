import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/scan.js';

const KEY = ['sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('');
const ids = (r) => r.findings.map((f) => f.ruleId).sort();

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-git-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'pipe' });
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  git('init', '-q');
  write('.gitignore', 'node_modules\n.env*\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, git, write };
}

describe('--staged', () => {
  test('only staged files are reported', () => {
    const { dir, git, write } = repo();
    write('staged.ts', `k = "${KEY}"`);
    write('unstaged.ts', `k = "${KEY}"`);
    git('add', 'staged.ts');
    const r = scanProject(dir, { staged: true });
    assert.equal(r.mode, 'staged');
    assert.deepEqual(r.findings.map((f) => f.file), ['staged.ts']);
  });

  test('reads staged content, not working tree', () => {
    const { dir, git, write } = repo();
    write('a.ts', `k = "${KEY}"`);
    git('add', 'a.ts');
    write('a.ts', 'k = process.env.KEY'); // removed from file, but still in the index
    assert.deepEqual(ids(scanProject(dir, { staged: true })), ['openai-key']);

    const other = repo();
    other.write('b.ts', 'k = process.env.KEY');
    other.git('add', 'b.ts');
    other.write('b.ts', `k = "${KEY}"`); // added after git add — not in this commit
    assert.deepEqual(scanProject(other.dir, { staged: true }).findings, []);
  });

  test('nothing staged gives no findings and a note', () => {
    const { dir } = repo();
    const r = scanProject(dir, { staged: true });
    assert.deepEqual(r.findings, []);
    assert.ok(r.notes.some((n) => n.key === 'stagedEmpty'));
  });

  test('staged .env file is critical', () => {
    const { dir, git, write } = repo();
    write('.env.local', 'X=1\n');
    git('add', '-f', '.env.local');
    assert.deepEqual(ids(scanProject(dir, { staged: true })), ['env-file-committed']);
  });

  test('RLS from an earlier committed migration is taken into account', () => {
    const { dir, git, write } = repo();
    write('supabase/migrations/001.sql', 'create table todos (id int);\nalter table todos enable row level security;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'm1');
    write('supabase/migrations/002.sql', 'create policy "own" on todos using (auth.uid() = user_id);\n');
    git('add', '.');
    assert.deepEqual(scanProject(dir, { staged: true }).findings, []);
  });

  test('new table without RLS in staged migration is reported', () => {
    const { dir, git, write } = repo();
    write('supabase/migrations/001.sql', 'create table old_t (id int);\n'); // old problem, not in this commit
    git('add', '.');
    git('commit', '-q', '-m', 'm1');
    write('supabase/migrations/002.sql', 'create table new_t (id int);\n');
    git('add', '.');
    const r = scanProject(dir, { staged: true });
    assert.deepEqual(r.findings.map((f) => `${f.ruleId} ${f.file}`), ['rls-not-enabled supabase/migrations/002.sql']);
  });

  test('throws outside git repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-'));
    assert.throws(() => scanProject(dir, { staged: true }), /git/);
  });
});

describe('gitignored .env files in git mode', () => {
  const pub = (name) => ['NEXT_', 'PUBLIC_', name].join('');

  test('public secret in ignored .env.local is reported, file is not flagged as committed', () => {
    const { dir, write } = repo();
    write('.env.local', `${pub('OPEN' + 'AI_API_KEY')}=abc123\nOPENAI_API_KEY=${KEY}\n`);
    const r = scanProject(dir);
    assert.equal(r.mode, 'git');
    assert.deepEqual(ids(r), ['public-env-secret']);
    assert.equal(r.findings[0].file, '.env.local');
    assert.ok(!JSON.stringify(r).includes(KEY));
  });

  test('ignored .env in a subfolder is checked, node_modules is not', () => {
    const { dir, write } = repo();
    write('.gitignore', 'node_modules\n.env*\n');
    write('apps/web/.env.local', `${pub('STRIPE_SECRET' + '_KEY')}=abc\n`);
    write('node_modules/pkg/.env', `${pub('STRIPE_SECRET' + '_KEY')}=abc\n`);
    assert.deepEqual(scanProject(dir).findings.map((f) => f.file), ['apps/web/.env.local']);
  });

  test('safe public variables in ignored .env are fine', () => {
    const { dir, write } = repo();
    write('.env.local', `${pub('SUPABASE_URL')}=https://x.supabase.co\n${pub('SUPABASE_ANON_KEY')}=xxx\n`);
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('ignored .env files are excluded by .vibescanignore and skipped in --staged', () => {
    const { dir, write, git } = repo();
    write('.env.local', `${pub('OPEN' + 'AI_API_KEY')}=abc123\n`);
    write('a.ts', 'x = 1');
    git('add', 'a.ts');
    assert.deepEqual(scanProject(dir, { staged: true }).findings, []);
    assert.deepEqual(scanProject(dir, { exclude: ['.env.local'] }).findings, []);
  });
});
