# /leakhound fix — fix critical findings one by one

1. Run `scan_project` (CLI: `npx leakhound . --json --lang <lang>`). Take only the
   **critical** findings. None → say so; if there are high ones, offer to go through
   them the same way, and stop.
2. Say how many critical findings there are and that you will go one by one, asking
   before every change.
3. For each finding, in order:
   1. Explain it in plain words ([scan.md](scan.md), step 2).
   2. Say exactly what you will change: which files, what moves where
      (per [fixes.md](fixes.md)). Never show the real key value.
   3. Ask: "Make this change?" — and wait. "No" or "skip" → move on to the next finding
      without changing anything.
   4. Make only that change. Do not touch unrelated code.
   5. Some fixes need the user's hands — setting an env variable in Vercel or Supabase,
      rotating a key. Tell them what to do; do not do it for them.
4. Findings from git history (`source: history`) cannot be fixed by editing files:
   add them straight to the rotation list.
5. Run `scan_project` again and show what is fixed and what is left.
6. **End with the list of keys to rotate** — every key that was in code, in a committed
   `.env` file or in history, including the ones you just moved to env variables:
   the provider, the masked fragment (`sk-pro…****`), where it was found, and where to
   rotate it ([fixes.md](fixes.md), last part). Say clearly: moving a key out of the code
   does not make it safe — whoever saw it can still use it until it is rotated.
7. Do not commit. Suggest `/leakhound staged` before the user commits.
