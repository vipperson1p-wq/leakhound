// Local MCP server over stdio: `vibe-scanner mcp` (or `npx -y vibecode-scanner mcp`).
//
// - No dependencies: a small JSON-RPC loop instead of the SDK — less third-party code
//   in a security tool, and the package stays dependency-free.
// - Dual-era: modern MCP (2026-07-28: per-request `_meta`, `server/discover`) and legacy
//   clients that open with `initialize` (2024-11-05 … 2025-11-25).
// - Read-only tools. Secrets are masked by the engine; whole files are never returned —
//   only one-line snippets (≤160 chars).
// - Everything copied from the repository (paths, code, commit subjects) is wrapped in
//   <repository-data> and sanitized, so file contents cannot pose as instructions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { scan } from './api.js';
import { createT, detectLang, LANGS, ScanError } from './i18n/index.js';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const META = 'io.modelcontextprotocol/';
const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unsupportedVersion: -32022 };
const MAX_FINDINGS = 50;

const SERVER_INFO = {
  name: 'vibecode-scanner',
  version: JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version,
};

const TOOLS = {
  scan_project: { history: false, staged: false },
  scan_staged: { history: false, staged: true },
  scan_history: { history: true, staged: false },
};

// ---------- Untrusted data from the repository ----------

// One line, no tag-like brackets: a file must not be able to close <repository-data>
export const sanitize = (value, max = 200) => {
  const s = String(value ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const data = (value) => `<repository-data>${sanitize(value)}</repository-data>`;

export function formatResult(result, t, displayPath) {
  const count = (s) => result.findings.filter((f) => f.severity === s).length;
  const counts = t('report.counts', { critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low') });
  const lines = [
    t('mcp.header', { path: displayPath }),
    `${t('report.mode')}: ${t(`report.modes.${result.mode}`)} · ${t('report.filesScanned')}: ${result.filesScanned}`,
    result.findings.length ? t('mcp.found', { counts }) : t('mcp.clean'),
  ];
  if (result.findings.length) lines.push('', t('mcp.dataNotice'));

  result.findings.slice(0, MAX_FINDINGS).forEach((f, i) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    lines.push('', `${i + 1}. [${t(`severity.${f.severity}`)}] ${f.title} (${f.ruleId})`);
    lines.push(`   ${t('mcp.file')}: ${data(loc)}${f.clientSide ? ` — ${t('mcp.clientSide')}` : ''}`);
    if (f.snippet) lines.push(`   ${t('mcp.code')}: ${data(f.snippet)}`);
    if (f.commit) lines.push(`   ${t('mcp.commit')}: ${f.commit.short} (${f.commit.date}) ${data(f.commit.subject)}`);
    lines.push(`   ${t('mcp.why')}: ${f.why}`);
    lines.push(`   ${t('mcp.fix')}: ${f.fix.replace(/\n/g, ' | ')}`);
  });
  if (result.findings.length > MAX_FINDINGS) {
    lines.push('', t('mcp.more', { count: result.findings.length - MAX_FINDINGS }));
  }
  if (result.notes.length) lines.push('', `${t('mcp.notes')}:`, ...result.notes.map((n) => `- ${n}`));
  lines.push('', `${t('mcp.notChecked')}:`, ...result.notChecked.map((x) => `- ${x.what} — ${x.hint}`));
  return lines.join('\n');
}

// ---------- Tools ----------

function toolList(t) {
  const props = {
    path: { type: 'string', description: t('mcp.params.path') },
    lang: { type: 'string', enum: LANGS, description: t('mcp.params.lang') },
    exclude: { type: 'array', items: { type: 'string' }, description: t('mcp.params.exclude') },
  };
  return Object.keys(TOOLS).map((name) => ({
    name,
    title: t(`mcp.tools.${name}.title`),
    description: t(`mcp.tools.${name}.description`),
    inputSchema: { type: 'object', properties: props, additionalProperties: false },
    annotations: { title: t(`mcp.tools.${name}.title`), readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

const toolError = (text) => ({ content: [{ type: 'text', text }], isError: true });

// A project directory — not the home folder or a drive root (too broad, and not "a project")
function resolveProject(cwd, p, t) {
  const target = path.resolve(cwd, p ?? '.');
  if (!fs.existsSync(target)) return { error: t('mcp.errors.pathNotFound', { path: target }) };
  if (!fs.statSync(target).isDirectory()) return { error: t('mcp.errors.notDirectory', { path: target }) };
  const norm = (x) => path.resolve(x).replace(/[\\/]+$/, '').toLowerCase();
  if (norm(target) === norm(os.homedir()) || norm(target) === norm(path.parse(target).root)) {
    return { error: t('mcp.errors.tooBroad', { path: target }) };
  }
  return { target };
}

async function callTool(params, ctx) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (!Object.hasOwn(TOOLS, name)) throw rpcError(ERR.invalidParams, ctx.t('mcp.errors.unknownTool', { name: String(name) }));
  if (args.lang !== undefined && !LANGS.includes(args.lang)) return toolError(ctx.t('mcp.errors.badParam', { name: 'lang' }));
  if (args.path !== undefined && typeof args.path !== 'string') return toolError(ctx.t('mcp.errors.badParam', { name: 'path' }));
  if (args.exclude !== undefined && !(Array.isArray(args.exclude) && args.exclude.every((x) => typeof x === 'string'))) {
    return toolError(ctx.t('mcp.errors.badParam', { name: 'exclude' }));
  }
  const lang = args.lang ?? ctx.lang;
  const t = createT(lang);
  const { target, error } = resolveProject(ctx.cwd, args.path, t);
  if (error) return toolError(error);
  try {
    const result = await scan(target, { lang, exclude: args.exclude ?? [], ...TOOLS[name] });
    return { content: [{ type: 'text', text: formatResult(result, t, target) }], isError: false };
  } catch (e) {
    return toolError(e instanceof ScanError ? t(`errors.${e.key}`, e.params) : `vibe-scanner: ${e.message}`);
  }
}

// ---------- JSON-RPC ----------

const rpcError = (code, message, data) => Object.assign(new Error(message), { rpc: { code, message, ...(data && { data }) } });

// Returns a response object, or null for notifications
export async function handleMessage(msg, ctx) {
  if (Array.isArray(msg) || !msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: ERR.invalidRequest, message: 'Invalid Request' } };
  }
  const isNotification = !('id' in msg);
  const version = msg.params?._meta?.[`${META}protocolVersion`];
  const modern = version !== undefined;
  try {
    if (modern && !MODERN_VERSIONS.includes(version)) {
      throw rpcError(ERR.unsupportedVersion, 'Unsupported protocol version', {
        supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: version,
      });
    }
    let result;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        result = {
          protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: ctx.t('mcp.instructions'),
        };
        break;
      }
      case 'server/discover':
        result = {
          supportedVersions: MODERN_VERSIONS,
          capabilities: { tools: {} },
          instructions: ctx.t('mcp.instructions'),
          _meta: { [`${META}serverInfo`]: SERVER_INFO },
          ttlMs: 3600000,
          cacheScope: 'public',
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: toolList(ctx.t), ...(modern && { ttlMs: 3600000, cacheScope: 'public' }) };
        break;
      case 'tools/call':
        result = await callTool(msg.params, ctx);
        break;
      default:
        if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
        throw rpcError(ERR.methodNotFound, `Method not found: ${msg.method}`);
    }
    if (isNotification) return null;
    if (modern) result = { resultType: 'complete', ...result };
    return { jsonrpc: '2.0', id: msg.id, result };
  } catch (e) {
    if (isNotification) return null;
    const error = e.rpc ?? { code: ERR.internal, message: e.message };
    return { jsonrpc: '2.0', id: msg.id, error };
  }
}

export async function serveStdio({ lang = detectLang(), cwd = process.cwd() } = {}) {
  const ctx = { lang, cwd, t: createT(lang) };
  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'Parse error' } });
      continue;
    }
    const response = await handleMessage(msg, ctx);
    if (response) send(response);
  }
}
