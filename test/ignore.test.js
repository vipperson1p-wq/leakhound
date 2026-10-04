import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseIgnoreFile, compileIgnore } from '../src/ignore.js';
import { scanProject } from '../src/scan.js';

describe('ignore patterns', () => {
  const cases = [
    // pattern, path, expected
    ['test-project/', 'test-project/app/route.ts', true],
    ['test-project/', 'apps/test-project/a.ts', true],
    ['test-project/', 'test-project-2/a.ts', false],
    ['fixtures', 'src/fixtures/a.json', true],
    ['fixtures', 'src/fixtures.ts', false],
    ['/docs', 'docs/a.md', true],
    ['/docs', 'src/docs/a.md', false],
    ['src/legacy', 'src/legacy/old.js', true],
    ['src/legacy', 'lib/src/legacy/old.js', false],
    ['*.min.js', 'public/vendor/jquery.min.js', true],
    ['*.min.js', 'public/app.js', false],
    ['src/**/*.snap', 'src/a/b/c.snap', true],
    ['src/**/*.snap', 'src/c.snap', true],
    ['CLAUDE.md', 'CLAUDE.md', true],
    ['test-project/', ['test-project', 'components', 'Chat.tsx'].join('\\'), true], // Windows paths
  ];
  for (const [pattern, p, expected] of cases) {
    test(`"${pattern}" ${expected ? 'matches' : 'does not match'} ${p}`, () => {
      assert.equal(compileIgnore([pattern])(p), expected);
    });
  }

  test('parseIgnoreFile skips comments, blanks and negations', () => {
    assert.deepEqual(parseIgnoreFile('# comment\n\ntest-project/\r\n  dist  \n!keep.js\n'), ['test-project/', 'dist']);
  });
});

describe('scanProject exclusions', () => {
  const leaky = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehound-'));
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
    fs.mkdirSync(path.join(dir, 'fixtures'));
    fs.writeFileSync(path.join(dir, 'fixtures', 'k.ts'), `k = "${['sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('')}"`);
    return dir;
  };

  test('without exclusions the finding is reported', () => {
    assert.equal(scanProject(leaky()).findings.length, 1);
  });

  test('exclude option skips matching files and adds a note', () => {
    const r = scanProject(leaky(), { exclude: ['fixtures/'] });
    assert.deepEqual(r.findings, []);
    assert.ok(r.notes.some((n) => n.key === 'excluded' && n.params.count === 1));
  });

  test('.vibehoundignore is respected', () => {
    const dir = leaky();
    fs.writeFileSync(path.join(dir, '.vibehoundignore'), '# fake keys\nfixtures/\n');
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('.vibescanignore from before the rename is still read, together with the new file', () => {
    const dir = leaky();
    fs.writeFileSync(path.join(dir, '.vibescanignore'), 'fixtures/\n');
    assert.deepEqual(scanProject(dir).findings, []);

    fs.mkdirSync(path.join(dir, 'other'));
    fs.copyFileSync(path.join(dir, 'fixtures', 'k.ts'), path.join(dir, 'other', 'k.ts'));
    assert.equal(scanProject(dir).findings.length, 1);
    fs.writeFileSync(path.join(dir, '.vibehoundignore'), 'other/\n');
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('.leakhoundignore from before the rename is still read, together with the new file', () => {
    const dir = leaky();
    fs.writeFileSync(path.join(dir, '.leakhoundignore'), 'fixtures/\n');
    assert.deepEqual(scanProject(dir).findings, []);

    fs.mkdirSync(path.join(dir, 'other'));
    fs.copyFileSync(path.join(dir, 'fixtures', 'k.ts'), path.join(dir, 'other', 'k.ts'));
    assert.equal(scanProject(dir).findings.length, 1);
    fs.writeFileSync(path.join(dir, '.vibehoundignore'), 'other/\n');
    assert.deepEqual(scanProject(dir).findings, []);
  });
});
