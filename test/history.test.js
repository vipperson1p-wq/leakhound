import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanHistory, findSecrets } from '../src/detectors/history.js';

const KEY = ['sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('');
const KEY2 = ['sk-', 'ant-', 'api03-', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('');
const CLI = path.resolve('src/index.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-hist-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  write('.gitignore', '.env*\n');
  commit('init');
  return { dir, git, write, commit };
}

describe('--history', () => {
  test('removed key is found with the commit that added it', async () => {
    const { dir, write, commit } = repo();
    write('src/config.ts', `// config\nexport const key = "${KEY}"\n`);
    const added = commit('add config');
    write('src/config.ts', 'export const key = process.env.OPENAI_API_KEY\n');
    commit('use env');

    const { findings, commitsScanned } = await scanHistory(dir);
    assert.equal(commitsScanned, 3);
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.ruleId, 'openai-key');
    assert.equal(f.source, 'history');
    assert.equal(f.file, 'src/config.ts');
    assert.equal(f.line, 2);
    assert.equal(f.commit.hash, added);
    assert.equal(f.commit.short, added.slice(0, 7));
    assert.ok(!JSON.stringify(findings).includes(KEY), 'secret must be masked');
  });

  test('key still present in files is left to the regular scan', async () => {
    const { dir, write, commit } = repo();
    write('a.ts', `k = "${KEY}"`);
    commit('add');
    assert.deepEqual((await scanHistory(dir)).findings, []);
  });

  test('reports the oldest commit when key was moved between files', async () => {
    const { dir, write, commit, git } = repo();
    write('a.ts', `k = "${KEY}"`);
    const first = commit('add to a');
    fs.rmSync(path.join(dir, 'a.ts'));
    write('b.ts', `k = "${KEY}"`);
    commit('move to b');
    write('b.ts', 'k = process.env.K');
    commit('remove');
    const { findings } = await scanHistory(dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].commit.hash, first);
    assert.equal(findings[0].file, 'a.ts');
    assert.ok(git('log', '--oneline').split('\n').length === 4);
  });

  test('keys on other branches are found (--all)', async () => {
    const { dir, write, commit, git } = repo();
    git('checkout', '-q', '-b', 'feature');
    write('x.ts', `k = "${KEY2}"`);
    commit('feature with key');
    git('checkout', '-q', 'main');
    const { findings } = await scanHistory(dir);
    assert.deepEqual(findings.map((f) => f.ruleId), ['anthropic-key']);
  });

  test('deleted .env file is reported', async () => {
    const { dir, write, commit, git } = repo();
    write('.env.local', 'SOME_TOKEN=abc\n');
    git('add', '-f', '.env.local');
    const added = commit('oops');
    git('rm', '-q', '--cached', '.env.local');
    commit('remove env');
    const { findings } = await scanHistory(dir);
    assert.deepEqual(findings.map((f) => f.ruleId), ['env-file-in-history']);
    assert.equal(findings[0].commit.hash, added);
  });

  test('excluded paths and .vibescanignore are respected', async () => {
    const { dir, write, commit } = repo();
    write('fixtures/k.ts', `k = "${KEY}"`);
    write('other/k.ts', `k = "${KEY2}"`);
    commit('add');
    write('fixtures/k.ts', '');
    write('other/k.ts', '');
    write('.vibescanignore', 'other/\n');
    commit('clear');
    assert.deepEqual((await scanHistory(dir, { exclude: ['fixtures/'] })).findings, []);
  });

  test('anon JWT and documentation example keys are ignored', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const anon = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon', iss: 'supabase' })}.FAKEsignatureFAKE`;
    assert.deepEqual(findSecrets(`a = "${anon}"; b = "${['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')}"`), []);
  });

  test('throws outside git repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-'));
    await assert.rejects(scanHistory(dir), /git/);
  });

  test('CLI --history adds history findings and exits with 1', () => {
    const { dir, write, commit } = repo();
    write('a.ts', `k = "${KEY}"`);
    commit('add');
    write('a.ts', '');
    commit('remove');
    const r = spawnSync(process.execPath, [CLI, dir, '--history', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.ok(out.findings.some((f) => f.source === 'history'));
    assert.ok(!out.notChecked.some((x) => x.id === 'git-history'));
    assert.ok(out.findings[0].why.includes(out.findings[0].commit.short), 'localized why mentions the commit');
    assert.ok(!r.stdout.includes(KEY));
  });

  test('CLI rejects --staged together with --history', () => {
    const r = spawnSync(process.execPath, [CLI, '--staged', '--history'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});
