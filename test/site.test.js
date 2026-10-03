// The landing site must only show commands that exist and output that the CLI really prints.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';

const PAGES = ['site/index.html', 'site/install/index.html'];
const html = Object.fromEntries(PAGES.map((p) => [p, fs.readFileSync(p, 'utf8')]));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (s) => decode(s.replace(/<[^>]+>/g, ''));

// Everything a visitor can copy or is shown as code
function snippets(page) {
  const src = html[page];
  return [
    ...[...src.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => m[1]),
    ...[...src.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((m) => m[1]),
    ...[...src.matchAll(/class="cmd-text">([^<]+)</g)].map((m) => m[1]),
  ].map((s) => text(s).trim());
}

const CLI_COMMANDS = new Set([
  'npx leakhound',
  'npx leakhound --history',
  'npx leakhound install-hook',
  'npx leakhound install-skill --user',
  'npx leakhound install-skill --cursor',
]);
const skill = fs.readFileSync('skills/leakhound/SKILL.md', 'utf8');
const SUBCOMMANDS = /argument-hint:\s*"?\[([^\]]+)\]/.exec(skill)[1].split('|').map((s) => s.trim());

describe('site commands exist', () => {
  for (const page of PAGES) {
    test(page, () => {
      const all = snippets(page);
      assert.ok(all.length > 3, 'found the snippets');
      for (const s of all) {
        if (s.startsWith('npx ')) assert.ok(CLI_COMMANDS.has(s), `unknown CLI command on the site: ${s}`);
        else if (s.startsWith('/leakhound')) {
          const sub = s.split(/\s+/)[1];
          assert.ok(!sub || SUBCOMMANDS.includes(sub), `unknown /leakhound subcommand: ${s}`);
        } else if (s.startsWith('claude mcp add')) {
          assert.equal(s, 'claude mcp add leakhound --scope user -- npx -y leakhound mcp');
        } else if (s.startsWith('{')) {
          assert.deepEqual(JSON.parse(s).mcpServers.leakhound, { command: 'npx', args: ['-y', 'leakhound', 'mcp'] });
        }
      }
      assert.doesNotMatch(html[page], /vibe-?scanner|vibecode/i, 'no old or foreign package names');
    });
  }
});

describe('the blocked-commit example on /install is the real hook output', () => {
  const demo = /<div class="hook-demo">([\s\S]*?)<\/figure>/.exec(html['site/install/index.html'])[1];
  const lines = [...demo.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));

  test('report part comes from the openai-key rule texts', () => {
    const rule = en.rules['openai-key'];
    assert.ok(lines.includes(`1. [${en.severity.critical}] ${rule.title}`));
    assert.ok(lines.includes(`   ${en.report.why} ${rule.why}`));
    assert.ok(lines.includes(`   ${en.report.fix} ${rule.fix}`));
  });

  test('hook part matches the hook messages', () => {
    for (const key of ['blocked', 'blockedFix1', 'blockedFix2', 'npmError1']) {
      assert.ok(lines.includes(en.hook[key]), `missing hook.${key}`);
    }
    assert.ok(lines.includes(en.hook.npmError2.replace('{package}', 'leakhound')), 'missing hook.npmError2');
  });

  test('the key in the example stays masked', () => {
    assert.ok(lines.some((l) => l.includes('sk-pro…****')));
    assert.doesNotMatch(demo, /sk-proj-[A-Za-z0-9]{8,}/);
  });
});

test('hook message says it blocks on critical and high, in both languages', () => {
  assert.match(en.hook.blocked, /critical or high/);
  assert.match(ru.hook.blocked, new RegExp(`${ru.severity.critical} или ${ru.severity.high}`));
});
