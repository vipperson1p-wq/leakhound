import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';
import { detectLang, createT, localizeFinding, localizeResult, LANGS } from '../src/i18n/index.js';
import * as rules from '../src/rules.js';
import { historyEnvRule } from '../src/detectors/history.js';
import { scanProject } from '../src/scan.js';
import { scan } from '../src/api.js';
import { installHook, hookMessages } from '../src/hook.js';

const CLI = path.resolve('src/index.js');
const CYRILLIC = /[А-Яа-яЁё]/;
const PLACEHOLDER = /\{\w+\}/;

// Env without any locale hints, so tests do not depend on the machine
const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const k of ['VIBEHOUND_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) delete env[k];
  return { ...env, ...extra };
};
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: cleanEnv(env) });

const keyPaths = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  (v && typeof v === 'object' ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const ALL_RULES = [
  ...rules.secretRules, rules.serviceRoleRule, rules.publicEnvRule, rules.genericSecretRule,
  rules.envFileRule, rules.gitignoreRule, rules.rlsMissingRule, rules.rlsUnverifiedRule,
  rules.permissivePolicyRule, historyEnvRule,
];

describe('dictionaries', () => {
  test('en and ru have exactly the same keys', () => {
    assert.deepEqual(keyPaths(ru).sort(), keyPaths(en).sort());
  });

  test('every rule has title, why and fix in every language', () => {
    for (const lang of LANGS) {
      const t = createT(lang);
      for (const rule of ALL_RULES) {
        for (const field of ['title', 'why', 'fix']) {
          assert.ok(t(`rules.${rule.id}.${field}`), `${lang}: rules.${rule.id}.${field}`);
        }
      }
    }
  });

  test('every "not checked" item exists in every language', () => {
    for (const lang of LANGS) {
      const t = createT(lang);
      for (const id of rules.NOT_CHECKED) assert.ok(t(`notChecked.${id}.what`) && t(`notChecked.${id}.hint`));
    }
  });

  test('English texts contain no Cyrillic, Russian titles are in Russian', () => {
    for (const p of keyPaths(en)) assert.ok(!CYRILLIC.test(createT('en')(p)), `en: ${p}`);
    for (const rule of ALL_RULES) assert.ok(CYRILLIC.test(createT('ru')(`rules.${rule.id}.title`)), `ru: ${rule.id}`);
  });

  test('hook messages are safe inside a shell script', () => {
    for (const lang of LANGS) assert.doesNotThrow(() => hookMessages(lang));
  });
});

describe('localization of findings', () => {
  const commit = { hash: 'a'.repeat(40), short: 'aaaaaaa', date: '2026-01-02', subject: 'x' };
  const samples = [
    ...ALL_RULES.map((r) => ({ ruleId: r.id, severity: 'high', params: { table: 'todos', name: 'NEXT_PUBLIC_X' } })),
    { ruleId: 'supabase-service-role', severity: 'critical', variant: 'publicEnv', params: { name: 'NEXT_PUBLIC_KEY' } },
    { ruleId: 'permissive-policy', severity: 'low', variant: 'selectOnly' },
    { ruleId: 'rls-not-enabled', severity: 'critical', snippetKey: 'rlsMissing', params: { table: 'todos' } },
    { ruleId: 'rls-unverified', severity: 'medium', snippetKey: 'rlsUnverified', params: { table: 'todos' } },
    { ruleId: 'gitignore-missing-env', severity: 'medium', snippetKey: 'gitignoreMissing' },
    { ruleId: 'openai-key', severity: 'critical', source: 'history', commit, snippet: 'k = "sk-pro…****"' },
    { ruleId: 'env-file-in-history', severity: 'high', source: 'history', commit },
  ];

  for (const lang of LANGS) {
    test(`all finding kinds are fully localized (${lang})`, () => {
      const t = createT(lang);
      for (const f of samples) {
        const out = localizeFinding(f, t);
        for (const field of ['title', 'why', 'fix']) {
          assert.ok(out[field], `${f.ruleId}.${field}`);
          assert.ok(!PLACEHOLDER.test(out[field]), `${lang} ${f.ruleId}.${field}: ${out[field]}`);
        }
        if (out.snippet) assert.ok(!PLACEHOLDER.test(out.snippet));
        assert.equal(out.variant, undefined);
        assert.equal(out.snippetKey, undefined);
      }
    });
  }

  test('variants and params are used', () => {
    const t = createT('en');
    const pub = localizeFinding(samples.find((f) => f.variant === 'publicEnv'), t);
    assert.match(pub.why, /NEXT_PUBLIC_KEY/);
    const hist = localizeFinding(samples.find((f) => f.source === 'history' && f.ruleId === 'openai-key'), t);
    assert.match(hist.title, /in git history/);
    assert.match(hist.why, /aaaaaaa/);
    const unv = localizeFinding(samples.find((f) => f.snippetKey === 'rlsUnverified'), createT('ru'));
    assert.match(unv.why, /todos/);
    assert.match(unv.snippet, /todos — нет CREATE TABLE/);
  });

  test('localizeResult on the fixture: English has no Cyrillic, Russian does', () => {
    const raw = scanProject('test-project');
    const enOut = JSON.stringify(localizeResult(raw, 'en'));
    const ruOut = JSON.stringify(localizeResult(raw, 'ru'));
    assert.ok(!CYRILLIC.test(enOut));
    assert.ok(CYRILLIC.test(ruOut));
    assert.ok(!PLACEHOLDER.test(enOut.replace(/"snippet":"[^"]*"/g, '')));
  });

  test('api.scan returns localized result with lang', async () => {
    const r = await scan('test-project', { lang: 'ru' });
    assert.equal(r.lang, 'ru');
    assert.ok(r.findings.every((f) => f.title && f.why && f.fix));
    assert.ok(r.notChecked.every((x) => x.id && x.what && x.hint));
  });
});

describe('language detection', () => {
  const cases = [
    [{ flag: 'ru', env: {} }, 'ru'],
    [{ flag: 'en', env: { LANG: 'ru_RU.UTF-8' } }, 'en'],
    [{ env: { VIBEHOUND_LANG: 'ru', LANG: 'en_US.UTF-8' } }, 'ru'],
    [{ env: { LANG: 'ru_RU.UTF-8' } }, 'ru'],
    [{ env: { LC_ALL: 'ru_RU.UTF-8', LANG: 'en_US.UTF-8' } }, 'ru'],
    [{ env: { LANG: 'de_DE.UTF-8' }, systemLocale: 'ru-RU' }, 'en'],
    [{ env: { LANG: 'C.UTF-8' }, systemLocale: 'ru-RU' }, 'ru'],
    [{ env: {}, systemLocale: 'ru-RU' }, 'ru'],
    [{ env: {}, systemLocale: 'en-US' }, 'en'],
    [{ env: {}, systemLocale: 'fr-FR' }, 'en'],
  ];
  for (const [opts, expected] of cases) {
    test(`${JSON.stringify(opts)} → ${expected}`, () => assert.equal(detectLang(opts), expected));
  }

  test('unknown --lang throws', () => {
    assert.throws(() => detectLang({ flag: 'de' }), /Unknown language: de/);
  });
});

describe('CLI languages', () => {
  test('English is the default without locale hints', () => {
    const r = cli(['test-project'], { LANG: 'en_US.UTF-8' });
    assert.match(r.stdout, /Why it is dangerous:/);
    assert.match(r.stdout, /What the scanner does NOT check/);
    assert.ok(!CYRILLIC.test(r.stdout));
  });

  test('--lang ru gives a Russian report', () => {
    const r = cli(['test-project', '--lang', 'ru'], { LANG: 'en_US.UTF-8' });
    assert.match(r.stdout, /Почему опасно:/);
    assert.match(r.stdout, /Что сканер НЕ проверяет/);
    assert.match(r.stdout, /КРИТИЧНО/);
  });

  test('Russian system locale switches to Russian automatically', () => {
    assert.match(cli(['test-project'], { LANG: 'ru_RU.UTF-8' }).stdout, /Почему опасно:/);
    assert.match(cli(['test-project', '--lang=en'], { LANG: 'ru_RU.UTF-8' }).stdout, /Why it is dangerous:/);
  });

  test('--json texts follow the language, ruleIds do not', () => {
    const enR = JSON.parse(cli(['test-project', '--json', '--lang', 'en']).stdout);
    const ruR = JSON.parse(cli(['test-project', '--json', '--lang', 'ru']).stdout);
    assert.deepEqual(enR.findings.map((f) => f.ruleId), ruR.findings.map((f) => f.ruleId));
    assert.notEqual(enR.findings[0].title, ruR.findings[0].title);
    assert.equal(ruR.lang, 'ru');
  });

  test('errors are localized and exit with 2', () => {
    const enR = cli(['--bogus'], { LANG: 'en_US.UTF-8' });
    assert.equal(enR.status, 2);
    assert.match(enR.stderr, /Unknown flag: --bogus/);
    const ruR = cli(['--bogus', '--lang', 'ru']);
    assert.equal(ruR.status, 2);
    assert.match(ruR.stderr, /Неизвестный флаг: --bogus/);
  });

  test('bad or missing --lang value exits with 2', () => {
    assert.equal(cli(['--lang', 'de']).status, 2);
    assert.match(cli(['--lang', 'de'], { LANG: 'en_US.UTF-8' }).stderr, /Unknown language: de/);
    assert.equal(cli(['.', '--lang']).status, 2);
  });
});

describe('hook languages', () => {
  const KEY = ['sk-', 'proj-', 'Z9y8X7w6V5u4T3s2R1q0P9o8'].join('');
  const repo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehound-i18n-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env*\n');
    return dir;
  };

  test('Russian hook: Russian messages and report, --lang ru passed to the scanner', () => {
    const dir = repo();
    installHook(dir, { lang: 'ru' });
    const script = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
    assert.match(script, /--staged --lang ru/);
    assert.match(script, /Коммит заблокирован/);
    fs.writeFileSync(path.join(dir, 'a.ts'), `k = "${KEY}"`);
    execFileSync('git', ['add', '.'], { cwd: dir });
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x'], {
      cwd: dir, encoding: 'utf8', env: cleanEnv({ LANG: 'en_US.UTF-8' }),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Коммит заблокирован/);
    assert.match(r.stdout + r.stderr, /Ключ OpenAI в коде/);
  });

  test('English hook by default', () => {
    const dir = repo();
    installHook(dir);
    const script = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
    assert.match(script, /--staged --lang en/);
    assert.ok(!CYRILLIC.test(script));
  });

  test('install-hook CLI output is localized', () => {
    const dir = repo();
    assert.match(cli(['install-hook', dir, '--lang', 'ru']).stdout, /хук установлен/);
    assert.match(cli(['install-hook', dir, '--lang', 'en']).stdout, /hook installed/);
  });
});
