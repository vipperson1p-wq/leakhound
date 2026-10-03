// `vibe-scanner install-skill`: puts the agent skill where the AI tool looks for it.
//   project (default) → <project>/.claude/skills/vibe-scanner/SKILL.md   (Claude Code, Agent Skills standard)
//   --user            → ~/.claude/skills/vibe-scanner/SKILL.md
//   --cursor          → <project>/.cursor/rules/vibe-scanner.mdc         (Cursor rule)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanError } from './i18n/index.js';

export const SKILL_SOURCE = fileURLToPath(new URL('../skills/vibe-scanner/SKILL.md', import.meta.url));
export const SKILL_MARKER = '<!-- vibe-scanner skill';

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
  if (where === 'user') return path.join(home, '.claude', 'skills', 'vibe-scanner', 'SKILL.md');
  if (where === 'cursor') return path.join(path.resolve(root), '.cursor', 'rules', 'vibe-scanner.mdc');
  return path.join(path.resolve(root), '.claude', 'skills', 'vibe-scanner', 'SKILL.md');
}

// Returns { file, overwritten }. Our own older copy is updated; a foreign file needs --force.
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
  return { file, overwritten: exists };
}
