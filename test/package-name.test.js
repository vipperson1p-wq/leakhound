// The package and the command are both `leakhound`. Two other names must never
// be what we tell the user to fetch from npm:
//   vibe-scanner     — someone else's package: it would run foreign code;
//   vibecode-scanner — our old name, deprecated after the rename to LeakHound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const FORBIDDEN = ['vibe-scanner', 'vibecode-scanner'];

// npx / bunx / pnpx / pnpm dlx / yarn dlx / npm exec / npm i — with any flags — then the name
const runs = (name) => new RegExp(
  `\\b(?:npx|bunx|pnpx|(?:npm|pnpm|yarn)\\s+(?:dlx|exec|i|install|add))(?:\\s+-[\\w=@.-]+)*\\s+["'\`]?${name}(?![\\w-])`,
);
// MCP configs: { "command": "npx", "args": ["-y", "<name>", ...] }
const mcpRuns = (name) => new RegExp(`"command"\\s*:\\s*"(?:npx|bunx|pnpx)"[^}]*?"${name}(?:@[^"]*)?"`);

function packageFiles() {
  const out = ['package.json'];
  const walk = (p) => {
    if (fs.statSync(p).isDirectory()) for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    else out.push(p);
  };
  for (const entry of PKG.files) if (fs.existsSync(entry)) walk(entry);
  return out;
}

test('the package is leakhound and so is its only command', () => {
  assert.equal(PKG.name, 'leakhound');
  assert.deepEqual(Object.keys(PKG.bin), ['leakhound']);
});

for (const name of FORBIDDEN) {
  test(`the patterns catch \`${name}\` and allow leakhound`, () => {
    for (const bad of [
      `npx ${name} .`,
      `npx -y ${name} mcp`,
      `npx --yes ${name}@0.1.0 --staged`,
      `bunx ${name}`,
      `pnpm dlx ${name}`,
      `npm exec ${name}`,
      `npm i -g ${name}`,
      `npm install -D ${name}`,
    ]) assert.match(bad, runs(name), bad);
    assert.match(`{ "command": "npx", "args": ["-y", "${name}", "mcp"] }`, mcpRuns(name));

    for (const good of [
      'npx leakhound .',
      'npx -y leakhound mcp',
      'npm install -D leakhound',
      'claude mcp add leakhound -- npx -y leakhound mcp',
      `LeakHound used to be published as \`${name}\`.`,
    ]) assert.doesNotMatch(good, runs(name), good);
    assert.doesNotMatch('"leakhound": { "command": "npx", "args": ["-y", "leakhound", "mcp"] }', mcpRuns(name));
  });

  test(`nothing in the package tells the user to run \`${name}\` from npm`, () => {
    const files = packageFiles();
    assert.ok(files.some((f) => f.endsWith('en.js')) && files.some((f) => f.endsWith('SKILL.md')), 'walked the package');
    const hits = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (runs(name).test(line) || mcpRuns(name).test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(hits, [], `use \`npx leakhound\` — \`${name}\` is not this package`);
  });
}
