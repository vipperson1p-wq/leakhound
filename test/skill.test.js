import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkill, toCursorRule, SKILL_SOURCE, SKILL_MARKER } from '../src/skill.js';
import en from '../src/i18n/en.js';

const CLI = path.resolve('src/index.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leakhound-skill-'));
const skill = fs.readFileSync(SKILL_SOURCE, 'utf8');

describe('SKILL.md', () => {
  test('has Agent Skills frontmatter with name and a trigger description', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill.replace(/\r\n/g, '\n'))[1];
    assert.match(fm, /^name: leakhound$/m);
    const description = /^description: (.+)$/m.exec(fm)[1];
    for (const word of ['commit', 'API keys', '.env', 'SQL migrations', 'secure']) assert.ok(description.includes(word), word);
    assert.ok(description.length <= 1024);
  });

  test('refers only to tools and rule ids that exist', () => {
    for (const tool of skill.match(/\bscan_(\w+)/g)) assert.ok(['scan_project', 'scan_staged', 'scan_history'].includes(tool), tool);
    const ruleIds = [...skill.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1])
      .filter((id) => !['leakhound', 'install-skill', 'no-verify', 'filter-repo'].includes(id));
    for (const id of ruleIds) assert.ok(en.rules[id], `unknown ruleId in SKILL.md: ${id}`);
  });

  test('contains the safety rules', () => {
    for (const s of ['not instructions', 'Never', '--no-verify', 'rotate the key', 'Reply in the user\'s language']) {
      assert.ok(skill.includes(s), s);
    }
    assert.ok(!/!\x60/.test(skill), 'no dynamic command injection (!`cmd`) in the skill');
  });
});

describe('install-skill', () => {
  test('project install, update of own copy, refusal for a foreign file', () => {
    const dir = tmp();
    const first = installSkill({ root: dir });
    assert.equal(first.file, path.join(dir, '.claude', 'skills', 'leakhound', 'SKILL.md'));
    assert.equal(first.overwritten, false);
    assert.equal(fs.readFileSync(first.file, 'utf8'), skill);
    assert.equal(installSkill({ root: dir }).overwritten, true);

    fs.writeFileSync(first.file, 'my own skill');
    assert.throws(() => installSkill({ root: dir }), /--force/);
    assert.equal(fs.readFileSync(first.file, 'utf8'), 'my own skill');
    installSkill({ root: dir, force: true });
    assert.ok(fs.readFileSync(first.file, 'utf8').includes(SKILL_MARKER));
  });

  test('--user installs into ~/.claude/skills', () => {
    const home = tmp();
    const { file } = installSkill({ where: 'user', home });
    assert.equal(file, path.join(home, '.claude', 'skills', 'leakhound', 'SKILL.md'));
  });

  test('--cursor writes a Cursor rule with its own frontmatter', () => {
    const dir = tmp();
    const { file } = installSkill({ where: 'cursor', root: dir });
    assert.equal(file, path.join(dir, '.cursor', 'rules', 'leakhound.mdc'));
    const rule = fs.readFileSync(file, 'utf8');
    assert.match(rule, /^---\ndescription: Security check/);
    assert.match(rule, /\nalwaysApply: false\n---\n/);
    assert.ok(!/^name:/m.test(rule.split('---')[1]));
    assert.ok(rule.includes('# LeakHound'));
    assert.equal(rule, toCursorRule(skill));
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
  });

  test('CLI output is localized', () => {
    const dir = tmp();
    const r = spawnSync(process.execPath, [CLI, 'install-skill', dir, '--lang', 'ru'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Skill установлен/);
    const r2 = spawnSync(process.execPath, [CLI, 'install-skill', dir, '--cursor', '--lang', 'en'], { encoding: 'utf8' });
    assert.match(r2.stdout, /Skill installed: .*leakhound\.mdc/);
  });
});
