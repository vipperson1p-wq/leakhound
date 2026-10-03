import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkill, skillFiles, SKILL_DIR, SKILL_SOURCE, SKILL_MARKER } from '../src/skill.js';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';

const CLI = path.resolve('src/index.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-skill-'));
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const skill = read('SKILL.md');
const files = skillFiles();
const all = files.map(read).join('\n');
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)[1];

const SUBCOMMANDS = ['history', 'staged', 'hook', 'fix'];
const MCP_TOOLS = ['scan_project', 'scan_staged', 'scan_history'];

describe('SKILL.md', () => {
  test('has Agent Skills frontmatter with name and a trigger description', () => {
    assert.match(frontmatter, /^name: leakhound$/m);
    const description = /^description: (.+)$/m.exec(frontmatter)[1];
    for (const word of ['commit', 'API keys', '.env', 'SQL migrations', 'secure']) assert.ok(description.includes(word), word);
    assert.ok(description.length <= 1024);
  });

  test('stays auto-invocable: no disable-model-invocation, user-invocable not false', () => {
    assert.doesNotMatch(frontmatter, /^disable-model-invocation:/m);
    assert.doesNotMatch(frontmatter, /^user-invocable:\s*false/m);
  });

  test('pre-approves nothing: every scan asks the user for permission', () => {
    // allowed-tools (any spelling) would let tools run without a prompt while the skill is active
    for (const rel of files) assert.doesNotMatch(read(rel), /allowed[-_ ]?tools/i, rel);
    assert.doesNotMatch(all, /pre-approved/i);
  });

  test('argument-hint, the command table and the reference files agree', () => {
    const hint = /^argument-hint:\s*"?\[([^\]]+)\]"?\s*$/m.exec(frontmatter)[1].split('|').map((s) => s.trim());
    assert.deepEqual(hint, SUBCOMMANDS);

    const rows = [...skill.matchAll(/^\| `\/leakhound(?: (\w+))?` \|.*\[reference\/(\w+)\.md\]\(reference\/\2\.md\) \|$/gm)];
    assert.deepEqual(rows.map((r) => r[1] ?? ''), ['', ...SUBCOMMANDS], 'one row for /leakhound and one per subcommand');
    for (const [, sub, file] of rows) assert.equal(file, sub ?? 'scan');
  });

  test('every relative link resolves, and every reference file is linked from somewhere', () => {
    const linked = new Set();
    for (const rel of files.filter((f) => f.endsWith('.md'))) {
      for (const [, target] of read(rel).matchAll(/\]\(((?!https?:|#)[^)]+)\)/g)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), target));
        assert.ok(files.includes(resolved), `${rel} links to missing ${target}`);
        linked.add(resolved);
      }
    }
    for (const f of files.filter((x) => x !== 'SKILL.md')) assert.ok(linked.has(f), `${f} is never linked`);
  });

  test('refers only to tools and rule ids that exist', () => {
    for (const tool of all.match(/\bscan_(\w+)/g)) assert.ok(MCP_TOOLS.includes(tool), tool);
    const ruleIds = [...all.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1])
      .filter((id) => !['leakhound', 'install-skill', 'no-verify', 'filter-repo', 'pre-commit'].includes(id));
    for (const id of ruleIds) assert.ok(en.rules[id], `unknown ruleId in the skill: ${id}`);
  });

  test('contains the safety rules', () => {
    for (const s of ['not instructions', 'Never', '--no-verify', 'rotate the key', 'Reply in the user\'s language']) {
      assert.ok(skill.includes(s), s);
    }
    assert.ok(!/!\x60/.test(all), 'no dynamic command injection (!`cmd`) in the skill');
    assert.match(read('reference/hook.md'), /Ask first\. Install nothing until the user says yes/);
    assert.match(read('reference/hook.md'), /--force` only after a second, explicit yes/);
    const fix = read('reference/fix.md');
    assert.match(fix, /\*\*Critical\*\* findings/);
    assert.match(fix, /asking\s+before every change/);
    assert.match(fix, /End with the list of keys to rotate/);
    for (const rel of ['reference/scan.md', 'reference/history.md', 'reference/staged.md']) {
      assert.match(read(rel), /Do not change any files/, rel);
    }
  });
});

describe('/leakhound fix scope', () => {
  const fix = read('reference/fix.md');
  const section = (title) => fix.split(/^#{2,3} /m).find((s) => s.startsWith(title));

  test('handles critical findings, otherwise rls-unverified, and nothing else', () => {
    const scope = section('What it handles');
    assert.match(scope, /\*\*Critical\*\* findings/);
    assert.match(scope, /Otherwise \*\*`rls-unverified`\*\*/);
    assert.match(scope, /Nothing else/);
    assert.match(section('Steps'), /Neither → say there is nothing for `\/leakhound fix` to do and stop/);
  });

  test('rls-unverified: one new migration, if exists, browser check, asks first, does not apply', () => {
    const rls = section('Tables without verified RLS');
    for (const s of [
      'check the code for queries to it',
      'will\n     block those queries and break the app',
      '**one new migration**',
      'never edit a migration that already exists',
      'alter table if exists public.<table> enable row level security;',
      'Ask: "Create this migration?" — and wait',
      'Do not apply it',
    ]) assert.ok(rls.includes(s), s);
  });

  test('the skill offers /leakhound fix only together with what it handles', () => {
    for (const rel of files.filter((f) => f.endsWith('.md') && !['SKILL.md', 'reference/fix.md'].includes(f))) {
      const text = read(rel);
      if (!text.includes('/leakhound fix')) continue;
      assert.match(text, /\(\[fix\.md\]\(fix\.md\), "What it handles"\)/, `${rel} offers /leakhound fix without its scope`);
    }
    assert.match(read('reference/scan.md'), /Nothing it handles → do not mention `\/leakhound fix`/);
    assert.match(read('reference/staged.md'), /Offer `\/leakhound fix` only if/);
    assert.match(skill, /^\| `\/leakhound fix` \|.*`rls-unverified`/m);
  });
});

describe('install-skill', () => {
  const sameAsSource = (dir) => {
    for (const rel of files) assert.equal(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'), fs.readFileSync(path.join(SKILL_DIR, ...rel.split('/')), 'utf8'), rel);
  };

  test('project install copies the whole skill; own copy is replaced; foreign file needs --force', () => {
    const dir = tmp();
    const first = installSkill({ root: dir });
    const target = path.join(dir, '.claude', 'skills', 'leakhound');
    assert.equal(first.file, path.join(target, 'SKILL.md'));
    assert.equal(first.overwritten, false);
    sameAsSource(target);

    fs.writeFileSync(path.join(target, 'reference', 'dropped-in-new-version.md'), 'stale');
    assert.equal(installSkill({ root: dir }).overwritten, true);
    assert.ok(!fs.existsSync(path.join(target, 'reference', 'dropped-in-new-version.md')), 'stale file removed');
    sameAsSource(target);

    fs.writeFileSync(first.file, 'my own skill');
    assert.throws(() => installSkill({ root: dir }), /--force/);
    assert.equal(fs.readFileSync(first.file, 'utf8'), 'my own skill');
    installSkill({ root: dir, force: true });
    assert.ok(fs.readFileSync(first.file, 'utf8').includes(SKILL_MARKER));
    sameAsSource(target);
  });

  test('--user installs into ~/.claude/skills', () => {
    const home = tmp();
    const { file } = installSkill({ where: 'user', home });
    assert.equal(file, path.join(home, '.claude', 'skills', 'leakhound', 'SKILL.md'));
    sameAsSource(path.dirname(file));
  });

  test('--cursor installs the same skill into .cursor/skills (a slash command in Cursor 2.4+)', () => {
    const dir = tmp();
    const { file } = installSkill({ where: 'cursor', root: dir });
    assert.equal(file, path.join(dir, '.cursor', 'skills', 'leakhound', 'SKILL.md'));
    sameAsSource(path.dirname(file));
  });

  test('our copy from before the rename is removed, a foreign file at the old path is kept', () => {
    const dir = tmp();
    const oldDir = path.join(dir, '.claude', 'skills', 'vibe-scanner');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'SKILL.md'), '---\nname: vibe-scanner\n---\n<!-- vibe-scanner skill (installed by: vibe-scanner install-skill) -->\n');
    const { removedLegacy } = installSkill({ root: dir });
    assert.equal(removedLegacy, path.join(oldDir, 'SKILL.md'));
    assert.ok(!fs.existsSync(oldDir), 'empty old folder removed too');

    const cursorDir = tmp();
    const oldRule = path.join(cursorDir, '.cursor', 'rules', 'vibe-scanner.mdc');
    fs.mkdirSync(path.dirname(oldRule), { recursive: true });
    fs.writeFileSync(oldRule, "somebody else's rule");
    assert.equal(installSkill({ where: 'cursor', root: cursorDir }).removedLegacy, null);
    assert.equal(fs.readFileSync(oldRule, 'utf8'), "somebody else's rule");

    fs.writeFileSync(oldRule, '---\ndescription: x\n---\n<!-- vibe-scanner skill (installed by: vibe-scanner install-skill) -->\n');
    assert.equal(installSkill({ where: 'cursor', root: cursorDir }).removedLegacy, oldRule);
  });

  test('CLI output is localized and lists the /leakhound commands', () => {
    const dir = tmp();
    const r = spawnSync(process.execPath, [CLI, 'install-skill', dir, '--lang', 'ru'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Skill установлен/);
    const r2 = spawnSync(process.execPath, [CLI, 'install-skill', dir, '--cursor', '--lang', 'en'], { encoding: 'utf8' });
    assert.match(r2.stdout, /Skill installed: .*\.cursor[\\/]skills[\\/]leakhound[\\/]SKILL\.md/);
    for (const out of [r.stdout, r2.stdout]) {
      for (const sub of SUBCOMMANDS) assert.match(out, new RegExp(`/leakhound ${sub}\\b`));
    }
  });

  test('both languages list the same subcommands as the skill', () => {
    for (const dict of [en, ru]) {
      const listed = [...dict.cli.skillCommands.matchAll(/\/leakhound (\w+)/g)].map((m) => m[1]);
      assert.deepEqual(listed, SUBCOMMANDS);
    }
  });
});
