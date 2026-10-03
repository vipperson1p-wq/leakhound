// `leakhound install-skill`: puts the agent skill where the AI tool looks for it.
//   project (default) → <project>/.claude/skills/leakhound/SKILL.md   (Claude Code, Agent Skills standard)
//   --user            → ~/.claude/skills/leakhound/SKILL.md
//   --cursor          → <project>/.cursor/rules/leakhound.mdc         (Cursor rule)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanError } from './i18n/index.js';

export const SKILL_SOURCE = fileURLToPath(new URL('../skills/leakhound/SKILL.md', import.meta.url));
export const SKILL_MARKER = '<!-- leakhound skill';
// Before the rename the package was vibecode-scanner and the skill lived under vibe-scanner/
const LEGACY_SKILL_MARKER = '<!-- vibe-scanner skill';

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('SKILL.md has no frontmatter');
  const description = /^description:\s*(.+)$/m.exec(m[1])?.[1].trim();
  return { description, body: text.slice(m[0].length) };
}

// Cursor rules use their own frontmatter; the agent decides when to apply it by description
export function toCursorRule(skillText) {
  const { description, body } = splitFrontmatter(skillText);
  return `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n${body}`;
}

export function skillTarget({ where = 'project', root = '.', home = os.homedir() } = {}) {
  if (where === 'user') return path.join(home, '.claude', 'skills', 'leakhound', 'SKILL.md');
  if (where === 'cursor') return path.join(path.resolve(root), '.cursor', 'rules', 'leakhound.mdc');
  return path.join(path.resolve(root), '.claude', 'skills', 'leakhound', 'SKILL.md');
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

// Returns { file, overwritten, removedLegacy? }. Our own older copy is updated; a foreign file needs --force.
export function installSkill({ where = 'project', root = '.', force = false, home } = {}) {
  const source = fs.readFileSync(SKILL_SOURCE, 'utf8');
  const content = where === 'cursor' ? toCursorRule(source) : source;
  const file = skillTarget({ where, root, home });
  const exists = fs.existsSync(file);
  if (exists && !force && !fs.readFileSync(file, 'utf8').includes(SKILL_MARKER)) {
    throw new ScanError('skillExists', { path: file });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const removedLegacy = removeLegacyCopy({ where, root, home });
  return { file, overwritten: exists, removedLegacy };
}
