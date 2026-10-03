// The npm name `vibe-scanner` belongs to someone else's package. Our package is
// `vibecode-scanner`; `vibe-scanner` is only the command it installs. Anything
// that tells the user to fetch `vibe-scanner` from npm would run foreign code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PKG = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// npx / bunx / pnpx / pnpm dlx / yarn dlx / npm exec / npm i — with any flags — then the foreign name
const RUN_FOREIGN = /\b(?:npx|bunx|pnpx|(?:npm|pnpm|yarn)\s+(?:dlx|exec|i|install|add))(?:\s+-[\w=@.-]+)*\s+["'`]?vibe-scanner(?![\w-])/;
// MCP configs: { "command": "npx", "args": ["-y", "vibe-scanner", ...] }
const MCP_FOREIGN = /"command"\s*:\s*"(?:npx|bunx|pnpx)"[^}]*?"vibe-scanner(?:@[^"]*)?"/;

function packageFiles() {
  const out = ['package.json'];
  const walk = (p) => {
    if (fs.statSync(p).isDirectory()) for (const name of fs.readdirSync(p)) walk(path.join(p, name));
    else out.push(p);
  };
  for (const entry of PKG.files) if (fs.existsSync(entry)) walk(entry);
  return out;
}

test('the patterns catch the foreign package and allow ours', () => {
  for (const bad of [
    'npx vibe-scanner .',
    'npx -y vibe-scanner mcp',
    'npx --yes vibe-scanner@0.1.0 --staged',
    'bunx vibe-scanner',
    'pnpm dlx vibe-scanner',
    'npm exec vibe-scanner',
    'npm i -g vibe-scanner',
  ]) assert.match(bad, RUN_FOREIGN, bad);
  assert.match('{ "command": "npx", "args": ["-y", "vibe-scanner", "mcp"] }', MCP_FOREIGN);

  for (const good of [
    'npx vibecode-scanner .',
    'npx -y vibecode-scanner mcp',
    'npm install -D vibecode-scanner',
    'vibe-scanner install-hook',
    'node_modules/.bin/vibe-scanner --staged',
    'claude mcp add vibe-scanner -- npx -y vibecode-scanner mcp',
  ]) assert.doesNotMatch(good, RUN_FOREIGN, good);
  assert.doesNotMatch('"vibe-scanner": { "command": "npx", "args": ["-y", "vibecode-scanner", "mcp"] }', MCP_FOREIGN);
});

test('nothing in the package tells the user to run `vibe-scanner` from npm', () => {
  const files = packageFiles();
  assert.ok(files.some((f) => f.endsWith('en.js')) && files.some((f) => f.endsWith('SKILL.md')), 'walked the package');
  const hits = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (RUN_FOREIGN.test(line) || MCP_FOREIGN.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'use `npx vibecode-scanner` — `vibe-scanner` on npm is someone else\'s package');
});
