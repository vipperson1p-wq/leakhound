# /vibehound — scan the project

1. Run `scan_project` on the project root (CLI: `npx vibehound . --json --lang <lang>`).
2. Explain the findings as in "Explaining findings" in SKILL.md: critical and high first,
   2–3 plain sentences each, repeated findings grouped.
3. If the result has notes — files skipped, tables not verified, a plain folder instead of
   a git repository — say so in one line each. Never say "no problems" while something
   was not checked.
4. Clean result: say it in one sentence, then list what the scanner does NOT check
   (SKILL.md, last section).
5. Do not change any files. End with what the user can do next:
   - `/vibehound fix` — **only if** the scan found something it handles: a critical
     finding, or else an `rls-unverified` one ([fix.md](fix.md), "What it handles").
     Say which: "fix the critical findings one by one" or "add RLS for the unverified
     tables". Nothing it handles → do not mention `/vibehound fix`;
   - `/vibehound history` — also look for keys left in old commits;
   - `/vibehound hook` — check every commit automatically.
