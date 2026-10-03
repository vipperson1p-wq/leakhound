# /leakhound history — project plus the whole git history

1. Run `scan_history` on the project root (CLI: `npx leakhound . --history --json --lang <lang>`).
   It reports everything `/leakhound` does, plus keys that were deleted from files but
   are still in old commits. Not a git repository → say so and run `scan_project` instead.
2. Explain current findings as in `/leakhound` ([scan.md](scan.md)).
3. For findings with `source: history`, explain plainly: the key is still readable by anyone
   who can see the repository history — deleting it from the file was not enough.
   Name the commit from the finding. The fix is to **rotate the key**; list where to do it
   ([fixes.md](fixes.md), last part).
4. Do not rewrite history yourself. If the user asks, explain that it comes only after
   rotation, that it changes every commit hash, and that a public repository may already
   have been copied — then do it only with their explicit OK.
5. Do not change any files.
