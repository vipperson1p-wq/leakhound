// `vibehound install-skill`: puts the agent skill (SKILL.md + reference/) where the AI tool looks for it.
// The same folder is the auto-invoked skill and the `/vibehound [history|staged|hook|fix]` command.
//   project (default) → <project>/.claude/skills/vibehound/   (Claude Code; Cursor reads it too)
//   --user            → ~/.claude/skills/vibehound/
//   --cursor          → <project>/.cursor/skills/vibehound/   (Cursor 2.4+)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanError } from './i18n/index.js';

export const SKILL_DIR = fileURLToPath(new URL('../skills/vibehound', import.meta.url));
export const SKILL_SOURCE = path.join(SKILL_DIR, 'SKILL.md');
export const SKILL_MARKER = '<!-- vibehound skill';

// Every file of the skill, as paths relative to SKILL_DIR
export function skillFiles(dir = SKILL_DIR, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? skillFiles(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

export function skillTarget({ where = 'project', root = '.', home = os.homedir() } = {}) {
  const base = where === 'user' ? home : path.resolve(root);
  return path.join(base, where === 'cursor' ? '.cursor' : '.claude', 'skills', 'vibehound', 'SKILL.md');
}

// Skills installed under the old names: vibecode-scanner (skill "vibe-scanner") and leakhound.
// Each old copy would sit next to the new one and give the agent conflicting skills.
function legacyCopies({ where = 'project', root = '.', home = os.homedir() } = {}) {
  const base = where === 'user' ? home : path.resolve(root);
  if (where === 'cursor') {
    return [
      { marker: '<!-- vibe-scanner skill', file: path.join(base, '.cursor', 'rules', 'vibe-scanner.mdc'), dir: null },
      { marker: '<!-- leakhound skill', file: path.join(base, '.cursor', 'skills', 'leakhound', 'SKILL.md'), dir: path.join(base, '.cursor', 'skills', 'leakhound') },
    ];
  }
  return ['vibe-scanner', 'leakhound'].map((name) => {
    const dir = path.join(base, '.claude', 'skills', name);
    return { marker: `<!-- ${name} skill`, file: path.join(dir, 'SKILL.md'), dir };
  });
}

// Removed only if the old SKILL.md carries our old marker — a foreign file at that path is left alone.
// A leakhound copy is a folder (SKILL.md + reference/), so the whole folder goes.
function removeLegacyCopies(opts) {
  const removed = [];
  for (const { marker, file, dir } of legacyCopies(opts)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!text.includes(marker)) continue;
    if (dir && marker === '<!-- leakhound skill') {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } else {
      fs.rmSync(file);
      if (dir) { try { fs.rmdirSync(dir); } catch { /* not empty — leave it */ } }
      removed.push(file);
    }
  }
  return removed;
}

// Returns { file, overwritten, removedLegacy: [paths] }. Our own older copy is replaced as a whole
// (so files dropped from a newer version disappear); a foreign SKILL.md needs --force.
export function installSkill({ where = 'project', root = '.', force = false, home } = {}) {
  const file = skillTarget({ where, root, home });
  const dir = path.dirname(file);
  const exists = fs.existsSync(file);
  const ours = exists && fs.readFileSync(file, 'utf8').includes(SKILL_MARKER);
  if (exists && !ours && !force) throw new ScanError('skillExists', { path: file });
  if (ours) fs.rmSync(dir, { recursive: true, force: true });
  for (const rel of skillFiles()) {
    const to = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(SKILL_DIR, ...rel.split('/')), to);
  }
  const removedLegacy = removeLegacyCopies({ where, root, home });
  return { file, overwritten: exists, removedLegacy };
}
