# Security Policy

Vibe Scanner is a security tool, so bugs in it can hurt the people who rely on it.
Thank you for reporting them responsibly.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**Security** tab → **Report a vulnerability**
([direct link](https://github.com/vipperson1p-wq/vibe-scanner/security/advisories/new)).

Please include:

- what is affected (version or commit, OS, Node.js version);
- steps to reproduce — ideally a minimal project or file;
- what you expected and what happened.

**Never include real secrets.** Use fake keys of the same format
(for example, build them from parts or replace characters) — see the tests in `test/`.

## What counts as a vulnerability

- A secret is printed **unmasked** anywhere: terminal, `--json`, hook output, error messages.
- Scanning a crafted project leads to code execution, writing files outside the
  scanned project, or reading files outside it.
- A crafted file makes the scanner hang or use excessive memory (e.g. ReDoS in a rule regex).
- The pre-commit hook can be bypassed by content in the commit itself
  (not by `git commit --no-verify`, which is a documented git feature).

**Not a vulnerability** (please open a regular issue instead):

- a missed key format or a false positive — use the
  [false positive](../../issues/new?template=false-positive.yml) or
  [rule request](../../issues/new?template=rule-request.yml) templates;
- problems in the projects you scan — the scanner exists to find those.

## What to expect

This is a small open-source project maintained in spare time:

- acknowledgement within **7 days**;
- a fix or a plan within **30 days** for confirmed issues;
- credit in the release notes, if you want it.

## Supported versions

Only the latest version on the `main` branch receives security fixes.
