// `leakhound install-skill`: puts the agent skill (SKILL.md + reference/) where the AI tool looks for it.
// The same folder is the auto-invoked skill and the `/leakhound [history|staged|hook|fix]` command.
//   project (default) → <project>/.claude/skills/leakhound/   (Claude Code; Cursor reads it too)
//   --user            → ~/.claude/skills/leakhound/
//   --cursor          → <project>/.cursor/skills/leakhound/   (Cursor 2.4+)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanError } from './i18n/index.js';

export const SKILL_DIR = fileURLToPath(new URL('../skills/leakhound', import.meta.url));
export const SKILL_SOURCE = path.join(SKILL_DIR, 'SKILL.md');
export const SKILL_MARKER = '<!-- leakhound skill';
// Before the rename the package was vibecode-scanner and the skill lived under vibe-scanner/
const LEGACY_SKILL_MARKER = '<!-- vibe-scanner skill';

// Every file of the skill, as paths relative to SKILL_DIR
export function skillFiles(dir = SKILL_DIR, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? skillFiles(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

export function skillTarget({ where = 'project', root = '.', home = os.homedir() } = {}) {
  const base = where === 'user' ? home : path.resolve(root);
  return path.join(base, where === 'cursor' ? '.cursor' : '.claude', 'skills', 'leakhound', 'SKILL.md');
}

function legacyTarget({ where = 'project', root = '.', home = os.homedir() } = {}) {
  if (where === 'user') return path.join(home, '.claude', 'skills', 'vibe-scanner', 'SKILL.md');
  if (where === 'cursor') return path.join(path.resolve(root), '.cursor', 'rules', 'vibe-scanner.mdc');
  return path.join(path.resolve(root), '.claude', 'skills', 'vibe-scanner', 'SKILL.md');
}

// The old copy would sit next to the new one and give the agent two conflicting skills.
// Removed only if it carries our old marker — a foreign file at that path is left alone.
function removeLegacyCopy(opts) {
  const file = legacyTarget(opts);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  if (!text.includes(LEGACY_SKILL_MARKER)) return null;
  fs.rmSync(file);
  if (opts.where !== 'cursor') {
    try { fs.rmdirSync(path.dirname(file)); } catch { /* not empty — leave it */ }
  }
  return file;
}

// Returns { file, overwritten, removedLegacy? }. Our own older copy is replaced as a whole
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
  const removedLegacy = removeLegacyCopy({ where, root, home });
  return { file, overwritten: exists, removedLegacy };
}
