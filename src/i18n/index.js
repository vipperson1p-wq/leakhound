// Localization. The engine returns language-neutral data (ruleId, params, note keys);
// texts are added here, at output time — for the terminal, --json and the future MCP server.
import en from './en.js';
import ru from './ru.js';

export const DICTIONARIES = { en, ru };
export const LANGS = Object.keys(DICTIONARIES);
export const DEFAULT_LANG = 'en';

// Error with a dictionary key, so the CLI can show it in the user's language
export class ScanError extends Error {
  constructor(key, params = {}) {
    super(format(en.errors[key] ?? key, params));
    this.key = key;
    this.params = params;
  }
}

function format(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);

export function createT(lang = DEFAULT_LANG) {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES[DEFAULT_LANG];
  return (key, params) => {
    const s = lookup(dict, key) ?? lookup(en, key);
    if (typeof s !== 'string') throw new Error(`Missing translation: ${key}`);
    return format(s, params);
  };
}

// Language from a locale string like "ru_RU.UTF-8" or "ru-RU"; null if it says nothing
function fromLocale(value) {
  if (!value) return null;
  const code = String(value).toLowerCase().split(/[_.@-]/)[0];
  if (!code || code === 'c' || code === 'posix') return null;
  return LANGS.includes(code) ? code : DEFAULT_LANG;
}

// Order: --lang → VIBESCAN_LANG → LC_ALL / LC_MESSAGES / LANG → system locale (Intl) → en
export function detectLang({ flag, env = process.env, systemLocale } = {}) {
  if (flag) {
    if (!LANGS.includes(flag)) throw new ScanError('unknownLang', { lang: flag });
    return flag;
  }
  if (env.VIBESCAN_LANG && LANGS.includes(env.VIBESCAN_LANG)) return env.VIBESCAN_LANG;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const lang = fromLocale(env[name]);
    if (lang) return lang;
  }
  const sys = systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return fromLocale(sys) ?? DEFAULT_LANG;
}

export function localizeFinding(f, t) {
  const base = `rules.${f.ruleId}`;
  let title = t(`${base}.title`);
  let why = t(`${base}.${f.variant ? `why_${f.variant}` : 'why'}`, f.params);
  let fix = t(`${base}.fix`, f.params);
  if (f.source === 'history' && f.ruleId !== 'env-file-in-history') {
    title += t('history.titleSuffix');
    why += ` ${t('history.why', { commit: f.commit.short, date: f.commit.date })}`;
    fix = t('history.fix');
  }
  const snippet = f.snippetKey ? t(`snippets.${f.snippetKey}`, f.params) : f.snippet;
  const { variant, snippetKey, ...rest } = f;
  return { ...rest, snippet, title, why, fix };
}

// A raw scan result → the same result with texts in the chosen language
export function localizeResult(result, lang = DEFAULT_LANG) {
  const t = createT(lang);
  return {
    ...result,
    lang,
    findings: result.findings.map((f) => localizeFinding(f, t)),
    notes: result.notes.map((n) => t(`notes.${n.key}`, n.params)),
    notChecked: result.notChecked.map((id) => ({ id, ...lookupNotChecked(t, id) })),
  };
}

const lookupNotChecked = (t, id) => ({ what: t(`notChecked.${id}.what`), hint: t(`notChecked.${id}.hint`) });
