# Contributing

Thanks for helping make vibe-coded apps safer! The most valuable contributions are:

- **new rules** for key formats and Supabase misconfigurations;
- **false-positive reports** — every one makes the scanner more trustworthy;
- fixes and tests.

## Ground rules

1. **Detection is deterministic.** Rules are regexes and parsing — no AI, no network calls.
2. **Never commit real secrets** — not in tests, not in issues, not in examples.
   Build fake keys from parts at runtime (see below).
3. **Secrets are always masked** in every output. If you add a new output path, test it.
4. **No dependencies** unless discussed in an issue first.
5. One feature — one pull request, with tests.

## Setup

Node.js 18+, nothing to install:

```bash
git clone https://github.com/vipperson1p-wq/vibecode-scanner.git
cd vibecode-scanner
npm test               # unit tests (node:test)
npm run scan:self      # the scanner must pass on its own code
npm run scan:fixture   # demo run on the intentionally vulnerable test-project/
```

`test-project/` contains **fake** keys on purpose. Don't "fix" it; it is excluded
from the self-scan via `.vibescanignore`.

## Adding a secret rule

Secret rules live in [`src/rules.js`](src/rules.js), in the `secretRules` array:

```js
{
  id: 'example-key',                 // kebab-case, stable: used in JSON, baselines, issues
  title: 'Ключ Example в коде',      // shown in the report (Russian for now)
  severity: 'critical',              // critical | high | medium | low
  regex: /\bexk_live_[A-Za-z0-9]{32}\b/g,
  why: 'What an attacker can do with it, in plain words.',
  fix: 'How to revoke/rotate it and where to keep it instead.',
},
```

Regex checklist:

- **Must have the `g` flag** — the engine uses `matchAll`.
- **Anchor it**: use the provider's fixed prefix and `\b`, so it doesn't match inside other strings.
- **Be specific**: exact length or charset from the provider's docs beats `{20,}` guesses.
- **No catastrophic backtracking**: avoid nested quantifiers like `(a+)+`; the scanner reads untrusted files.
- **Works on Node 18**: no inline flags like `(?i)`.
- If the provider publishes example keys in its docs, add them to `KNOWN_EXAMPLE_KEYS`.

Severity guide:

| Severity | Meaning |
|---|---|
| critical | Direct access to money, data or infrastructure (live payment keys, cloud keys, DB admin keys) |
| high | Serious, but limited or needs extra steps |
| medium | Often public by design, or can't be verified from code |
| low | Likely noise or bad practice (test keys, generic "password = ...") |

### Tests for a rule

Add a fake key to the `FAKE` map in [`test/rules.test.js`](test/rules.test.js) —
the existing tests then check that it is detected, reported exactly once,
and masked in the output:

```js
'example-key': j('exk_', 'live_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'),
```

**Build fake keys from parts** (`j('exk_', 'live_', …)`) so that the test file itself
doesn't contain a matching string — otherwise the self-scan fails.

Also add tests for what must **not** match: placeholders (`your-key-here`),
similar-looking keys of other providers, documentation examples.

## Adding a Supabase / SQL check

SQL checks are in `scanSqlFiles` in [`src/scan.js`](src/scan.js). Remember that
a table can be created in one migration and secured in another — checks work across
all migration files. Tests go to the `SQL / …` sections of `test/rules.test.js`.

## Using rules from other projects

- **gitleaks** (MIT) — allowed with attribution in `NOTICE`.
- **TruffleHog** (AGPL-3.0) and **Semgrep rules** (Semgrep Rules License) —
  **do not copy** code or rules, and please don't port them by reading their source.
- Provider documentation — write the regex yourself from the documented format and link the source in the PR.

## Pull request checklist

- [ ] `npm test` passes
- [ ] `npm run scan:self` passes
- [ ] new rule has positive **and** negative tests
- [ ] no real secrets anywhere (fake keys are built from parts)
- [ ] `README.md` "What it checks" table updated if behavior changed

## Reporting false positives

Open an issue with the **False positive** template. Paste the line with the key
**replaced by a fake** of the same shape — never the real value.

Security problems in the scanner itself: see [SECURITY.md](SECURITY.md).
