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
  'leakhound', // after npm install -g
]);
const NPM_COMMANDS = new Set(['npm install -g leakhound', 'npm install -D leakhound', 'npm install']);
const skill = fs.readFileSync('skills/leakhound/SKILL.md', 'utf8');
const SUBCOMMANDS = /argument-hint:\s*"?\[([^\]]+)\]/.exec(skill)[1].split('|').map((s) => s.trim());

describe('site commands exist', () => {
  for (const page of PAGES) {
    test(page, () => {
      const all = snippets(page);
      assert.ok(all.length > 3, 'found the snippets');
      for (const s of all) {
        if (s.startsWith('npx ') || s.startsWith('leakhound')) assert.ok(CLI_COMMANDS.has(s), `unknown CLI command on the site: ${s}`);
        else if (s.startsWith('npm ')) assert.ok(NPM_COMMANDS.has(s), `unknown npm command on the site: ${s}`);
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

test('package.json has the bin the global install promises', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.deepEqual(pkg.bin, { leakhound: 'src/index.js' });
});

test('"Other ways to install" is a real details/summary, and the offline claim matches the hook', () => {
  const page = html['site/install/index.html'];
  const more = /<details class="more">([\s\S]*?)<\/details>/.exec(page);
  assert.ok(more, 'details block exists');
  assert.match(more[1], /<summary>Other ways to install<\/summary>/);
  assert.ok(more[1].includes('npm install -g leakhound') && more[1].includes('npm install -D leakhound'));
  // "without internet" is only true for the local copy: the hook runs node_modules/.bin first
  const hook = fs.readFileSync('src/hook.js', 'utf8');
  assert.ok(hook.indexOf('./node_modules/.bin/leakhound') < hook.indexOf('npx --yes'), 'hook tries the local copy before npx');
  assert.doesNotMatch(more[1].split('In your project')[0], /internet|offline/i, 'no offline claim for the global install');
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

describe('security headers (site/vercel.json)', () => {
  const config = JSON.parse(fs.readFileSync('site/vercel.json', 'utf8'));
  const headers = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  const csp = Object.fromEntries(headers['Content-Security-Policy'].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

  test('CSP allows only what the pages load', () => {
    assert.deepEqual(csp, {
      'default-src': ["'none'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ['https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
    });
    assert.doesNotMatch(headers['Content-Security-Policy'], /unsafe-|\*/);
  });

  test('the other headers are set', () => {
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['X-Frame-Options'], 'DENY');
  });

  for (const page of PAGES) {
    test(`${page} works under that CSP: no inline code, outside loads only from allowed hosts`, () => {
      const src = html[page];
      assert.doesNotMatch(src, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline <script>');
      assert.doesNotMatch(src, /\sstyle="/, 'no style attributes');
      assert.doesNotMatch(src, /\son[a-z]+="/, 'no inline event handlers');
      for (const [, url] of src.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="(https?:\/\/[^"]+)"/g)) {
        assert.ok(/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(url), `unexpected external resource: ${url}`);
      }
    });
  }
});
