import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSecrets, scanSqlFiles, scanEnvFile, scanProject } from '../src/scan.js';

// Fake secrets are assembled at runtime so this file itself
// does not trigger the scanner during self-check.
const j = (...parts) => parts.join('');
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (role) => j(
  b64url({ alg: 'HS256', typ: 'JWT' }), '.',
  b64url({ iss: 'supabase', ref: 'fakeproject12', role, iat: 1700000000 }), '.',
  'FAKEsignatureFAKEsignature',
);

const FAKE = {
  'anthropic-key': j('sk-', 'ant-', 'api03-', 'A1b2C3d4E5f6G7h8I9j0K1l2'),
  'openai-key': j('sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'),
  'stripe-live-key': j('sk_', 'live_', 'Q1w2E3r4T5y6U7i8O9p0A1s2'),
  'stripe-test-key': j('sk_', 'test_', 'Q1w2E3r4T5y6U7i8O9p0A1s2'),
  'aws-access-key': j('AK', 'IA', 'ZXCVBNMASDFGHJKL'),
  'github-token': j('gh', 'p_', 'a'.repeat(18), 'B'.repeat(18)),
  'supabase-secret-key': j('sb_', 'secret_', 'N1m2B3v4C5x6Z7l8K9j0H1g2'),
  'google-api-key': j('AI', 'za', 'Sy', 'A'.repeat(33)),
  'private-key': j('-----BEGIN RSA ', 'PRIVATE KEY-----'),
};

const ids = (findings) => findings.map((f) => f.ruleId);

describe('secret rules', () => {
  for (const [ruleId, secret] of Object.entries(FAKE)) {
    test(`${ruleId} is detected`, () => {
      const found = scanSecrets('lib/config.ts', `const value = "${secret}"\n`);
      assert.ok(ids(found).includes(ruleId), `expected ${ruleId}, got ${ids(found)}`);
    });
  }

  test('each key yields exactly one finding (no duplicates across rules)', () => {
    for (const [ruleId, secret] of Object.entries(FAKE)) {
      const found = scanSecrets('lib/config.ts', `const value = "${secret}"\n`);
      assert.equal(found.length, 1, `${ruleId}: ${ids(found)}`);
    }
  });

  test('Anthropic key is not reported as OpenAI key', () => {
    const found = scanSecrets('a.ts', `k = "${FAKE['anthropic-key']}"`);
    assert.ok(!ids(found).includes('openai-key'));
  });

  test('reports correct line number', () => {
    const found = scanSecrets('a.ts', `// one\n// two\nconst k = "${FAKE['openai-key']}"\n`);
    assert.equal(found[0].line, 3);
  });

  test('clean code has no findings', () => {
    const code = [
      'const key = process.env.OPENAI_API_KEY',
      'const url = import.meta.env.VITE_SUPABASE_URL',
      'export default function Page() { return null }',
    ].join('\n');
    assert.deepEqual(scanSecrets('app/page.tsx', code), []);
  });
});

describe('Supabase JWT', () => {
  test('service_role key is detected', () => {
    const found = scanSecrets('lib/db.ts', `createClient(url, '${jwt('service_role')}')`);
    assert.deepEqual(ids(found), ['supabase-service-role']);
  });

  test('anon key is NOT reported', () => {
    const found = scanSecrets('lib/db.ts', `createClient(url, '${jwt('anon')}')`);
    assert.deepEqual(found, []);
  });

  test('anon key assigned to apiKey variable is NOT reported by generic rule', () => {
    const found = scanSecrets('lib/db.ts', j('const api', 'Key = "', jwt('anon'), '"'));
    assert.deepEqual(found, []);
  });

  test('service_role in a client component is marked clientSide', () => {
    const found = scanSecrets('components/Chat.tsx', `'use client'\nconst k = '${jwt('service_role')}'`);
    assert.equal(found[0].clientSide, true);
  });

  test('server route is not marked clientSide', () => {
    const found = scanSecrets('app/api/chat/route.ts', `const k = '${jwt('service_role')}'`);
    assert.equal(found[0].clientSide, false);
  });
});

describe('public env variables', () => {
  const pub = (name) => j('NEXT_PUBLIC_', name);

  for (const name of ['OPEN' + 'AI_API_KEY', 'SUPABASE_SERVICE' + '_ROLE_KEY', 'STRIPE_SECRET' + '_KEY']) {
    test(`${name} with public prefix is detected`, () => {
      const found = scanSecrets('.env.local', `${pub(name)}=abc123\n`);
      assert.deepEqual(ids(found), ['public-env-secret']);
    });
  }

  for (const prefix of ['VITE_', 'REACT_APP_', 'EXPO_PUBLIC_']) {
    test(`${prefix} prefix is detected`, () => {
      const found = scanSecrets('src/x.ts', j('const k = import.meta.env.', prefix, 'OPEN', 'AI_KEY'));
      assert.deepEqual(ids(found), ['public-env-secret']);
    });
  }

  test('anon key and URL with public prefix are NOT reported', () => {
    const env = [`${pub('SUPABASE_ANON_KEY')}=xxx`, `${pub('SUPABASE_URL')}=https://x.supabase.co`].join('\n');
    assert.deepEqual(scanSecrets('.env.local', env), []);
  });

  test('server-only variable is NOT reported', () => {
    assert.deepEqual(scanSecrets('.env.local', j('OPEN', 'AI_API_KEY=abc123')), []);
  });

  test('value of public variable is masked', () => {
    const found = scanSecrets('.env.local', `${pub('OPEN' + 'AI_API_KEY')}=verysecretvalue\n`);
    assert.ok(!found[0].snippet.includes('verysecretvalue'));
  });
});

describe('generic hardcoded secrets', () => {
  test('hardcoded password is detected with low severity', () => {
    const found = scanSecrets('a.ts', j('const pass', 'word = "', 'Hunter2Hunter2', '"'));
    assert.deepEqual(ids(found), ['hardcoded-secret']);
    assert.equal(found[0].severity, 'low');
  });

  const placeholders = ['your-api-key-here', 'xxxxxxxxxxxx', 'changeme123', 'example-token', '<YOUR_KEY>'];
  for (const value of placeholders) {
    test(`placeholder "${value}" is NOT reported`, () => {
      assert.deepEqual(scanSecrets('a.ts', j('const api', 'Key = "', value, '"')), []);
    });
  }

  test('short values are NOT reported', () => {
    assert.deepEqual(scanSecrets('a.ts', j('const pass', 'word = "', 'abc', '"')), []);
  });
});

describe('masking', () => {
  test('no finding contains the full secret', () => {
    const code = Object.values(FAKE).map((s, i) => `const k${i} = "${s}"`).join('\n')
      + `\nconst sr = '${jwt('service_role')}'`;
    const out = JSON.stringify(scanSecrets('lib/all.ts', code));
    for (const secret of [...Object.values(FAKE).filter((s) => !s.startsWith('-----')), jwt('service_role')]) {
      assert.ok(!out.includes(secret), `leaked: ${secret.slice(0, 8)}`);
    }
  });
});

describe('SQL / RLS', () => {
  const sql = (...files) => scanSqlFiles(files.map((content, i) => ({ rel: `m${i}.sql`, content })));

  test('table without RLS is detected', () => {
    assert.deepEqual(ids(sql('create table public.todos (id int);')), ['rls-not-enabled']);
  });

  test('table with RLS is NOT reported', () => {
    assert.deepEqual(sql('create table todos (id int);\nalter table todos enable row level security;'), []);
  });

  test('RLS enabled in a later migration counts', () => {
    assert.deepEqual(sql('create table "Todos" (id int);', 'ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;'), []);
  });

  test('tables outside public schema are ignored', () => {
    assert.deepEqual(sql('create table private.secrets (id int);'), []);
  });

  test('USING (true) for write is high', () => {
    const found = sql('create table t (id int); alter table t enable row level security;\ncreate policy "p" on t using (true);');
    assert.deepEqual(ids(found), ['permissive-policy']);
    assert.equal(found[0].severity, 'high');
  });

  test('USING (true) for select only is low', () => {
    const found = sql('create policy "p" on t for select using ( true );');
    assert.equal(found[0].severity, 'low');
  });

  test('WITH CHECK (true) is detected', () => {
    assert.deepEqual(ids(sql('create policy "p" on t for insert with check (true);')), ['permissive-policy']);
  });

  test('policy with auth.uid() is NOT reported', () => {
    assert.deepEqual(sql('create policy "own" on t using (auth.uid() = user_id);'), []);
  });
});

describe('scanProject', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-'));

  test('missing .gitignore is reported', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'index.js'), 'console.log(1)\n');
    const r = scanProject(dir);
    assert.equal(r.mode, 'folder');
    assert.deepEqual(ids(r.findings), ['gitignore-missing-env']);
  });

  test('clean project with proper .gitignore has no findings', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.env*\n');
    fs.writeFileSync(path.join(dir, 'index.js'), 'const k = process.env.KEY\n');
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('node_modules is skipped', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'i.js'), `k = "${FAKE['openai-key']}"`);
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('findings are sorted by severity', () => {
    const r = scanProject('test-project');
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const sev = r.findings.map((f) => order[f.severity]);
    assert.deepEqual(sev, [...sev].sort((a, b) => a - b));
  });

  test('test-project fixture: all expected problems are found', () => {
    const found = new Set(ids(scanProject('test-project').findings));
    for (const id of [
      'anthropic-key', 'openai-key', 'supabase-service-role', 'rls-not-enabled',
      'permissive-policy', 'gitignore-missing-env', 'hardcoded-secret',
    ]) {
      assert.ok(found.has(id), `missing ${id}`);
    }
  });
});

describe('.env files outside git', () => {
  const pub = (name) => j('NEXT_PUBLIC_', name);
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vibescan-'));

  test('secret in public variable is detected in folder mode', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
    fs.writeFileSync(path.join(dir, '.env.local'), `${pub('OPEN' + 'AI_API_KEY')}=abc123\n`);
    const r = scanProject(dir);
    assert.deepEqual(ids(r.findings), ['public-env-secret']);
    assert.equal(r.findings[0].file, '.env.local');
  });

  test('server-only secrets in .env are NOT reported in folder mode', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
    fs.writeFileSync(path.join(dir, '.env'), [
      j('OPEN', 'AI_API_KEY=', FAKE['openai-key']),
      j('SUPABASE_SERVICE', '_ROLE_KEY=', jwt('service_role')),
    ].join('\n'));
    assert.deepEqual(scanProject(dir).findings, []);
  });

  test('service_role JWT in public variable is detected', () => {
    const found = scanEnvFile('.env', `${pub('SUPABASE_ANON_KEY')}="${jwt('service_role')}"\n`);
    assert.deepEqual(ids(found), ['supabase-service-role']);
    assert.equal(found[0].clientSide, true);
    assert.ok(!found[0].snippet.includes(jwt('service_role')));
  });

  test('anon JWT in public variable is NOT reported', () => {
    assert.deepEqual(scanEnvFile('.env', `${pub('SUPABASE_ANON_KEY')}=${jwt('anon')}\n`), []);
  });

  test('.env.example is treated as regular file', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
    fs.writeFileSync(path.join(dir, '.env.example'), j('OPEN', 'AI_API_KEY=your-key-here\n'));
    assert.deepEqual(scanProject(dir).findings, []);
  });
});
