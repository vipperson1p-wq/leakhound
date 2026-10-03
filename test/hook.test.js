import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHook, HOOK_MARKER } from '../src/hook.js';

const KEY = ['sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('');
const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-hook-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
  return dir;
}

const commit = (dir) => spawnSync('git', [...GIT_ID, 'commit', '-q', '-m', 'test'], { cwd: dir, encoding: 'utf8' });
const hookFile = (dir) => path.join(dir, '.git', 'hooks', 'pre-commit');

describe('install-hook', () => {
  test('hook blocks commit with a secret and allows a clean one', () => {
    const dir = repo();
    installHook(dir);
    assert.ok(fs.readFileSync(hookFile(dir), 'utf8').includes(HOOK_MARKER));

    fs.writeFileSync(path.join(dir, 'leak.ts'), `k = "${KEY}"`);
    execFileSync('git', ['add', '.'], { cwd: dir });
    const blocked = commit(dir);
    assert.notEqual(blocked.status, 0, 'commit with a secret must fail');
    assert.match(blocked.stderr, /Коммит заблокирован/);
    assert.ok(!(blocked.stdout + blocked.stderr).includes(KEY), 'secret must be masked in hook output');

    fs.writeFileSync(path.join(dir, 'leak.ts'), 'k = process.env.KEY');
    execFileSync('git', ['add', '.'], { cwd: dir });
    const ok = commit(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  });

  test('hook lets commit through if scanner is missing', () => {
    const dir = repo();
    installHook(dir, { cliPath: path.join(dir, 'no-such-scanner.js') });
    fs.writeFileSync(path.join(dir, 'a.ts'), `k = "${KEY}"`);
    execFileSync('git', ['add', '.'], { cwd: dir });
    const r = commit(dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /проверка пропущена/);
  });

  test('installed from npm: hook uses npx with a pinned version, no absolute path', () => {
    const dir = repo();
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const cliPath = path.join(os.tmpdir(), '_npx', 'abc', 'node_modules', 'vibecode-scanner', 'src', 'index.js');
    const { runner } = installHook(dir, { cliPath });
    const script = fs.readFileSync(hookFile(dir), 'utf8');
    assert.ok(script.includes(`NPX_PACKAGE="vibecode-scanner@${pkg.version}"`));
    assert.ok(script.includes('SOURCE=""'));
    assert.ok(!script.includes(cliPath.replace(/\\/g, '/')));
    assert.equal(runner, `npx vibecode-scanner@${pkg.version}`);
  });

  test('installed from source: hook falls back to the source path, never to npx', () => {
    const dir = repo();
    installHook(dir);
    const script = fs.readFileSync(hookFile(dir), 'utf8');
    assert.ok(script.includes('NPX_PACKAGE=""'));
    assert.ok(script.includes(`SOURCE="${path.resolve('src/index.js').replace(/\\/g, '/')}"`));
  });

  test('locally installed package in node_modules/.bin is preferred', () => {
    const dir = repo();
    installHook(dir, { cliPath: path.join(dir, 'no-such-scanner.js') });
    const bin = path.join(dir, 'node_modules', '.bin', 'vibe-scanner');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '#!/bin/sh\necho "local-bin-called $1"\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.env*\n');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x = 1');
    execFileSync('git', ['add', 'a.ts', '.gitignore'], { cwd: dir });
    const r = commit(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /local-bin-called --staged/);
  });

  test('reinstalling over own hook is allowed', () => {
    const dir = repo();
    installHook(dir);
    const { backupPath } = installHook(dir);
    assert.equal(backupPath, undefined);
  });

  test('foreign hook is not overwritten without --force', () => {
    const dir = repo();
    fs.writeFileSync(hookFile(dir), '#!/bin/sh\necho mine\n');
    assert.throws(() => installHook(dir), /--force/);
    assert.equal(fs.readFileSync(hookFile(dir), 'utf8'), '#!/bin/sh\necho mine\n');
  });

  test('--force backs up foreign hook', () => {
    const dir = repo();
    fs.writeFileSync(hookFile(dir), '#!/bin/sh\necho mine\n');
    const { backupPath } = installHook(dir, { force: true });
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '#!/bin/sh\necho mine\n');
    assert.ok(fs.readFileSync(hookFile(dir), 'utf8').includes(HOOK_MARKER));
  });

  test('throws outside git repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-'));
    assert.throws(() => installHook(dir), /git init/);
  });
});
