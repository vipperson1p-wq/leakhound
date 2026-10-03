# /leakhound fix — fix findings one by one

## What it handles

- **Critical** findings in the current files, if there are any.
- Otherwise **`rls-unverified`** findings: tables that migrations use but never create
  or protect with RLS.
- Nothing else. High, other medium and low findings are explained by `/leakhound`, with
  how to fix them ([fixes.md](fixes.md)), but `/leakhound fix` does not take them.

Other commands offer `/leakhound fix` only when a scan found something from this list.

## Steps

1. Run `scan_project` (CLI: `npx leakhound . --json --lang <lang>`).
   - Critical findings → go to "Critical findings".
   - No critical, but `rls-unverified` → go to "Tables without verified RLS".
   - Neither → say there is nothing for `/leakhound fix` to do and stop. Do not change files.

### Critical findings

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

### Tables without verified RLS

2. Explain in plain words: the migrations use these tables but never turn on row-level
   security for them, so the scanner can't tell whether anyone with the public anon key
   can read and change every row. List the tables.
3. For each table, before proposing anything, check the code for queries to it
   (`.from('<table>')`, `.rpc` on it, realtime subscriptions):
   - used only from server code with the service key, or not at all → enabling RLS is safe;
   - used from browser code with the anon key → **enabling RLS without policies will
     block those queries and break the app.** Ask the user who should be allowed to read
     and change the rows, and propose policies (based on `auth.uid()`) in the same
     migration — or leave the table for now if they are not sure.
4. Propose **one new migration** — never edit a migration that already exists. Name it
   like the existing ones (for Supabase: `supabase/migrations/<YYYYMMDDHHMMSS>_enable_rls.sql`)
   and show its full content first:

   ```sql
   alter table if exists public.<table> enable row level security;
   ```

   One line per table, plus the policies agreed in step 3. `if exists` matters: the table
   was created outside migrations, so on a fresh local database it may not exist yet.
5. Ask: "Create this migration?" — and wait. The user can drop tables from the list.
   "No" → change nothing.
6. Create only that file. Do not apply it: say it takes effect with `supabase db push`
   (or the next deploy), and that until then the live database is unchanged.
7. Run `scan_project` again and show that the `rls-unverified` findings are gone.
   Do not commit. Suggest `/leakhound staged` before the user commits.
