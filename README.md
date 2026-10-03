# 🔍 Vibe Scanner

**English** · [Русский](README.ru.md)

A security scanner for "vibe-coded" projects — apps built with AI help on
**Next.js / Vite + Supabase + Vercel**. It catches the mistakes AI assistants
make most often, **before you deploy**:

- API keys hardcoded in code (OpenAI, Anthropic, Stripe, AWS, GitHub, Google, Supabase…)
- secrets in public env variables (`NEXT_PUBLIC_`, `VITE_`…) that end up in the browser
- `.env` files committed to git — including ones deleted later but still in history
- Supabase tables without Row Level Security and `USING (true)` policies

Every finding comes with a plain-language explanation and a concrete fix.
Keys are **always masked** in the output (`sk-pro…****`).

Reports are in **English** or **Russian** (`--lang ru`, or automatically when your system language is Russian).

## Quick start

Requires Node.js 18+. No dependencies. Run it in your project folder:

```bash
npx vibecode-scanner .
```

To block commits that contain keys, add it to the project and install the pre-commit hook:

```bash
npm install -D vibecode-scanner
npx vibe-scanner install-hook
```

The package is called `vibecode-scanner`; the command it installs is `vibe-scanner`.

## Usage

```bash
vibe-scanner <path>                     # scan a project
vibe-scanner <path> --json              # machine-readable output
vibe-scanner <path> --history           # also scan git history for removed keys
vibe-scanner <path> --exclude fixtures/ # skip paths (repeatable)
vibe-scanner --staged                   # only files staged for commit
vibe-scanner install-hook [path]        # pre-commit hook: block commits with critical/high findings
vibe-scanner <path> --lang ru           # report language: en (default) or ru
```

Without installing, use `npx vibecode-scanner` instead of `vibe-scanner`.

Language is picked in this order: `--lang` → `VIBESCAN_LANG` → `LC_ALL` / `LC_MESSAGES` / `LANG` → system locale → English.
`install-hook --lang ru` makes the hook messages and commit-time reports Russian.

### Programmatic use

```js
import { scan } from 'vibecode-scanner';
const result = await scan('.', { lang: 'en', history: true });
// result.findings: [{ ruleId, severity, file, line, snippet (masked), title, why, fix, ... }]
```

The pre-commit hook runs the scanner from `node_modules/.bin` if the package is installed
in the project, otherwise via `npx vibecode-scanner@<version>` (pinned to the version that
installed the hook — it never pulls a newer release on its own).

Exit code: `1` if there are critical or high findings, `0` otherwise, `2` on usage errors —
so it works in CI as is.

## Use it from your AI assistant (MCP + skill)

Let Claude Code, Cursor or Claude Desktop run the scanner for you — before commits,
after adding keys or env variables, after writing SQL migrations — and explain and fix
what it finds.

**MCP server.** Runs locally over stdio via `npx`; nothing is sent to our servers (there are none).
Tools are read-only: `scan_project`, `scan_staged`, `scan_history`. Secrets are always masked,
whole files are never returned, and code from your repository is marked as data, not
instructions, so a malicious file can't hijack the assistant.

<details open>
<summary>Claude Code</summary>

```bash
claude mcp add vibe-scanner -- npx -y vibecode-scanner mcp
```

Add `--scope project` to share it with your team via `.mcp.json`.
</details>

<details>
<summary>Cursor</summary>

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "vibe-scanner": { "command": "npx", "args": ["-y", "vibecode-scanner", "mcp"] }
  }
}
```
</details>

<details>
<summary>Claude Desktop</summary>

Settings → Developer → Edit Config, add to `claude_desktop_config.json`, restart Claude Desktop:

```json
{
  "mcpServers": {
    "vibe-scanner": { "command": "npx", "args": ["-y", "vibecode-scanner", "mcp"] }
  }
}
```

On Windows, if the server does not start, use `"command": "cmd", "args": ["/c", "npx", "-y", "vibecode-scanner", "mcp"]`.
Claude Desktop doesn't run inside your project, so ask it to scan a specific folder
(the tools take a `path`).
</details>

Add `--lang ru` to the args for Russian tool descriptions; each tool call can also pass `lang`.
To pin a version, use `vibecode-scanner@<version>` instead of `vibecode-scanner`.

**Skill.** Teaches the assistant *when* to scan and *how* to fix findings (move keys to
server-only env variables, tell you to rotate leaked keys, write RLS migrations), and never
to bypass the pre-commit hook:

```bash
npx vibecode-scanner install-skill            # .claude/skills/ in this project (Claude Code, Agent Skills)
npx vibecode-scanner install-skill --user     # ~/.claude/skills/ for all your projects
npx vibecode-scanner install-skill --cursor   # .cursor/rules/vibe-scanner.mdc for Cursor
```

The skill works with or without the MCP server: without it, the assistant runs the CLI.

## What it checks

| Check | Severity |
|---|---|
| Known secret key formats (OpenAI, Anthropic, Stripe live, AWS, GitHub, Supabase `sb_secret_` / `service_role` JWT, PEM private keys) | critical |
| Secrets in public env variables (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`) | high |
| `.env` files that are (or will be) committed to git | critical |
| `.env` files that were committed and later deleted (`--history`) | high |
| Keys removed from files but still in git history (`--history`) | critical |
| SQL migrations: table created without RLS | critical |
| SQL migrations: `USING (true)` / `WITH CHECK (true)` policies | high / low (read-only) |
| SQL migrations: table altered but created elsewhere — RLS can't be verified | medium |
| `.gitignore` doesn't protect `.env` | medium |
| Google API keys (often public by design, but should be restricted) | medium |
| Possible hardcoded passwords, Stripe test keys | low |

The Supabase `anon` key is public by design and is **not** reported.

In a git repository, the scanner checks files that are in the repo or would be
added by `git add .`, plus gitignored `.env*` files (for public variables only).

## What it does NOT check

"No problems found" does not mean "the project is secure". The scanner does not see:

- your live database (changes made in the Supabase dashboard) — use Supabase Security Advisor;
- access-control logic in your code (can user A read user B's data through your API?);
- vulnerable dependencies — use `npm audit`;
- the built bundle (`.next`, `dist`) and hosting settings (Vercel env vars, CORS, headers);
- XSS, SQL injection, prompt injection.

## Exclusions

Create `.vibescanignore` in the project root (simplified `.gitignore` syntax):

```
# comment
test-project/      # directory at any depth
/docs              # path from the project root
*.min.js           # globs: * and **
```

Or pass `--exclude <pattern>`.

## Principles

- **Detection is deterministic** — regexes and parsing, no AI deciding what is a vulnerability.
- **Secrets never leave your machine** and are masked in every output.
- **Only your own projects** — a local folder or a repo you have access to.

## Contributing

New rules, false-positive reports and fixes are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Found a vulnerability in the scanner itself? Please report it privately — see [SECURITY.md](SECURITY.md).

## Support the project

Vibe Scanner is free and open source, with no subscriptions. If it saved you
from leaking a key, you can support development:

<!-- TODO: donation link -->
*Donation link coming soon.*

## License

[MIT](LICENSE)
