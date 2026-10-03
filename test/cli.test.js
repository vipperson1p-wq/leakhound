import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CLI = path.resolve('src/index.js');
const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

// LEAKHOUND_LANG pins the language, so the system locale of the machine does not matter
function run(args, lang = 'en') {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, LEAKHOUND_LANG: lang },
  });
}

describe('--help', () => {
  for (const flag of ['--help', '-h']) {
    test(`${flag} prints usage and exits 0`, () => {
      const r = run([flag]);
      assert.equal(r.status, 0);
      assert.equal(r.stderr, '');
      assert.ok(r.stdout.includes(`leakhound ${VERSION}`));
      for (const item of ['--staged', '--history', 'install-hook', 'install-skill', 'mcp',
        '--json', '--exclude', '--lang', '--force', '--version', 'npx leakhound']) {
        assert.ok(r.stdout.includes(item), `help mentions ${item}`);
      }
    });
  }

  test('follows --lang and the detected language', () => {
    assert.match(run(['--help', '--lang', 'ru']).stdout, /Использование/);
    assert.match(run(['--help'], 'ru').stdout, /Использование/);
    assert.match(run(['--help', '--lang=en'], 'ru').stdout, /Usage:/);
  });

  test('wins over a command: mcp --help does not start the server', () => {
    const r = run(['mcp', '--help']);
    assert.equal(r.error, undefined, 'did not hang');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });

  test('works after other arguments', () => {
    const r = run(['.', '--staged', '-h']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });
});

describe('--version', () => {
  for (const flag of ['--version', '-v']) {
    test(`${flag} prints the package version`, () => {
      const r = run([flag]);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), VERSION);
    });
  }

  test('is the same in every language', () => {
    assert.equal(run(['--version'], 'ru').stdout.trim(), VERSION);
  });
});

test('unknown flags still fail with exit code 2', () => {
  const r = run(['--hlep']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--hlep/);
});
