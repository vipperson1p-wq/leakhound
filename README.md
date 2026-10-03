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

> ⚠️ Reports are currently in **Russian**. English output is planned.

## Quick start

Requires Node.js 18+. No dependencies.

```bash
git clone https://github.com/vipperson1p-wq/vibecode-scanner.git
cd vibecode-scanner
node src/index.js /path/to/your/project
```

> Not published to npm yet — run it from source for now.

## Usage

```bash
node src/index.js <path>                     # scan a project
node src/index.js <path> --json              # machine-readable output
node src/index.js <path> --history           # also scan git history for removed keys
node src/index.js <path> --exclude fixtures/ # skip paths (repeatable)
node src/index.js --staged                   # only files staged for commit
node src/index.js install-hook [path]        # pre-commit hook: block commits with critical/high findings
```

Exit code: `1` if there are critical or high findings, `0` otherwise, `2` on usage errors —
so it works in CI as is.

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
