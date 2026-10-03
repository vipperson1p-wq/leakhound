# /leakhound staged — only what goes into the next commit

1. Run `scan_staged` on the project root (CLI: `npx leakhound --staged --json --lang <lang>`).
   It checks the staged content of files from `git add`, not the working copy.
2. Nothing staged → say so and suggest `git add` first, or `/leakhound` for the whole project.
3. Critical or high findings → say clearly that this commit should not be made yet,
   explain each finding ([scan.md](scan.md), step 2) and offer `/leakhound fix`.
   Never suggest `git commit --no-verify`.
4. Clean → say the staged files are fine to commit. Mention in one line that files
   not staged were not checked.
5. Do not change any files and do not commit for the user.
