# /vibehound hook — install the pre-commit hook

**Ask first. Install nothing until the user says yes.**

1. Explain in 2–3 sentences: before every commit git will run vibehound on the staged
   files and stop the commit if it finds critical or high problems. Nothing leaves the
   computer. The hook file is `.git/hooks/pre-commit`; it is not committed, so each
   clone installs it again.
2. Check the project:
   - not a git repository → say the hook needs `git init` first and stop;
   - `vibehound` in `package.json` devDependencies → the hook will use it, fast and offline;
   - otherwise → the hook runs `npx vibehound@<version>` with the version pinned now;
     suggest `npm install -D vibehound` so commits don't need the network.
3. Ask: "Install the pre-commit hook?" — wait for a clear yes.
4. Run `npx vibehound install-hook --lang <lang>` from the project root.
5. If it reports that another pre-commit hook already exists: show the user the path,
   explain that `--force` saves the old hook as `pre-commit.backup` and replaces it,
   so the old checks stop running. Run with `--force` only after a second, explicit yes.
6. Show what the command printed and tell the user how to remove the hook:
   delete `.git/hooks/pre-commit`.
