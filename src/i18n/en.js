// English texts (default). Keys must match ru.js — test/i18n.test.js checks it.
// Parameters in braces: {table}, {count}, etc.
export default {
  severity: { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' },

  rules: {
    'anthropic-key': {
      title: 'Anthropic (Claude) API key in code',
      why: 'Anyone with this key can make Claude API requests on your bill.',
      fix: 'Revoke the key in the Anthropic Console, create a new one and keep it in a server-side environment variable.',
    },
    'openai-key': {
      title: 'OpenAI API key in code',
      why: 'Anyone with this key can spend your money on the OpenAI API.',
      fix: 'Revoke the key at platform.openai.com, create a new one and use it only on the server via process.env.',
    },
    'stripe-live-key': {
      title: 'Stripe live secret key',
      why: 'Gives access to payments, refunds and customer data.',
      fix: 'Revoke the key in the Stripe Dashboard right away and put the new one in server environment variables.',
    },
    'stripe-test-key': {
      title: 'Stripe test key in code',
      why: 'A test key does not touch real money, but it is a bad habit: a live key gets committed just as easily.',
      fix: 'Move the key to .env and make sure .env is in .gitignore.',
    },
    'aws-access-key': {
      title: 'AWS access key',
      why: 'Bots find these keys on GitHub within minutes and run crypto miners on your account.',
      fix: 'Deactivate the key in AWS IAM, check your bill for suspicious activity, create a new key.',
    },
    'github-token': {
      title: 'GitHub token',
      why: 'Gives access to your repositories, including private ones.',
      fix: 'Revoke the token in GitHub → Settings → Developer settings and create a new one with minimal permissions.',
    },
    'supabase-secret-key': {
      title: 'Supabase secret key (sb_secret_)',
      why: 'The secret key bypasses RLS and gives full access to the whole database.',
      fix: 'Generate a new key in Supabase → Project Settings → API Keys and use it only on the server.',
    },
    'google-api-key': {
      title: 'Google API key',
      why: 'Some Google keys (e.g. Firebase) are public by design, but without restrictions others can use them.',
      fix: 'In Google Cloud Console, restrict the key to your domains and to the list of allowed APIs.',
    },
    'private-key': {
      title: 'Private key (PEM)',
      why: 'A private key lets someone impersonate your server or service.',
      fix: 'Remove the key from the repository, reissue it and keep it outside the code.',
    },
    'supabase-service-role': {
      title: 'Supabase service_role key in code',
      why: 'This key bypasses all RLS policies. Whoever sees it gets full access to the database: read, change, delete.',
      why_publicEnv: 'The public variable {name} holds the service_role key instead of the anon key. It will ship to the browser, and any visitor gets full database access, bypassing RLS.',
      fix: 'Reset the key (Supabase → Project Settings → API) and use service_role only in server code via an environment variable. Only the anon key belongs in the browser.',
    },
    'public-env-secret': {
      title: 'Secret in a public environment variable',
      why: 'Variables prefixed with NEXT_PUBLIC_ / VITE_ / REACT_APP_ are embedded into the JavaScript the browser downloads. Every visitor can see them.',
      fix: 'Drop the public prefix and use the variable only on the server (API route, server component, edge function).',
    },
    'hardcoded-secret': {
      title: 'Possible hardcoded password or key',
      why: 'Looks like a password or key right in the code. May be a false positive — check it manually.',
      fix: 'If it is a real secret, move it to an environment variable.',
    },
    'env-file-committed': {
      title: '.env file is (or will be) committed to the repository',
      why: 'Every key in .env becomes visible to anyone with access to the repository — to the whole internet if it is public. Deleting the file does not help: it stays in git history.',
      fix: 'Add .env* to .gitignore, run `git rm --cached <file>`, and ALWAYS reissue every key from that file.',
    },
    'env-file-in-history': {
      title: '.env file was committed and remains in git history',
      why: 'The file was deleted from the repository, but its contents are still in an old commit. Anyone with access to the repository can get it.',
      fix: 'Treat every key from this file as leaked: reissue each of them. Deleting the file is not enough.',
    },
    'gitignore-missing-env': {
      title: '.gitignore does not protect .env files',
      why: 'One `git add .` and all your keys end up in the repository.',
      fix: 'Add these lines to .gitignore:\n.env\n.env.*\n!.env.example',
    },
    'rls-not-enabled': {
      title: 'Table without Row Level Security',
      why: 'In Supabase the anon key is public. If a table in the public schema has no RLS, anyone can read, change and delete all rows through the API.',
      fix: 'Add to a migration: ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; and create policies that allow access only to the right users.',
    },
    'rls-unverified': {
      title: 'RLS not verified: table created outside migrations',
      why: 'Migrations work with the table {table} but never create it or enable RLS on it. Most likely it was created in the Supabase dashboard. The scanner cannot tell whether RLS is enabled: if not, anyone with the anon key can read and change all rows.',
      fix: 'Check the table in Supabase → Table Editor (RLS badge) or in Security Advisor. Most reliable: add ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; to a migration (enabling it again is safe) — then it is visible in code and the scanner stops warning.',
    },
    'permissive-policy': {
      title: 'RLS policy allows everything (USING true)',
      why: 'A policy with the condition true lets in any user, including anonymous ones. RLS is on, but it does not protect anything.',
      why_selectOnly: 'Anyone (even without signing in) can read every row of this table. Fine for public data (blog posts), dangerous for personal data (profiles, messages).',
      fix: 'Replace true with a real condition, for example: USING (auth.uid() = user_id).',
    },
  },

  snippets: {
    rlsMissing: 'CREATE TABLE {table} … (RLS is not enabled anywhere)',
    rlsUnverified: '{table} — no CREATE TABLE and no ENABLE ROW LEVEL SECURITY in migrations',
    gitignoreMissing: 'No .gitignore file',
    gitignoreNoEnv: 'No line for .env',
  },

  history: {
    titleSuffix: ' — in git history',
    why: 'The key was already removed from files but remains in git history: it was added in commit {commit} ({date}).',
    fix: 'Reissue the key (revoke the old one) — that is what matters; removing it from the file is not enough. Rewriting history (git filter-repo, BFG) only makes sense AFTER rotating the key: if anyone has cloned the repository or it was public, the old key may already have leaked.',
  },

  notes: {
    stagedEmpty: 'Nothing is staged (git add has not been run yet).',
    stagedOnly: 'Only files from the upcoming commit were checked: {count}.',
    folderMode: 'Not a git repository: all files were checked, and .env files only for public variables (NEXT_PUBLIC_, VITE_, etc.).',
    excluded: 'Files excluded: {count} (.vibescanignore / --exclude).',
    noSql: 'No SQL migrations found: RLS was not checked. For Supabase this is usually the supabase/migrations folder.',
    historyFound: 'Git history checked: {commits} commits. Found in history: {count}.',
    historyClean: 'Git history checked: {commits} commits — no removed keys found in history.',
  },

  notChecked: {
    'live-db': { what: 'Your live database', hint: 'only migrations in the code are checked. Changes made in the Supabase dashboard are invisible — run Security Advisor in Supabase.' },
    'access-logic': { what: 'Access-control logic in code', hint: 'e.g. whether one user can get another user\'s data through your API route.' },
    dependencies: { what: 'Vulnerable dependencies', hint: 'use npm audit for that.' },
    'git-history': { what: 'Git history', hint: 'a key removed from a file stays in old commits. Run with --history.' },
    'build-output': { what: 'Built code (.next, dist)', hint: 'what actually ships to the browser after the build.' },
    hosting: { what: 'Hosting settings', hint: 'environment variables in Vercel, CORS, security headers.' },
    'logic-vulns': { what: 'XSS, SQL injection, prompt injection', hint: 'these need logic analysis, not pattern matching.' },
  },

  report: {
    mode: 'Mode',
    modes: { git: 'git repository', staged: 'commit files only (--staged)', folder: 'plain folder' },
    filesScanned: 'files scanned',
    noProblems: '✅ No problems found.',
    clientSide: 'looks like a client-side file — visible in the browser',
    commit: 'commit {commit} on {date} — "{subject}"',
    why: 'Why it is dangerous:',
    fix: 'How to fix:',
    total: 'Total:',
    counts: '{critical} critical · {high} high · {medium} medium · {low} low',
    notCheckedTitle: 'What the scanner does NOT check',
    notCheckedSubtitle: '("no problems found" ≠ "the project is secure"):',
  },

  errors: {
    excludeValue: '--exclude needs a path or pattern, e.g. --exclude test-project/',
    langValue: '--lang needs a language: en or ru',
    unknownLang: 'Unknown language: {lang}. Available: en, ru',
    unknownFlag: 'Unknown flag: {flag}',
    extraArg: 'Unexpected argument: {arg}',
    stagedWithHistory: '--staged and --history cannot be used together.',
    stagedNotGit: '--staged only works inside a git repository.',
    historyNotGit: '--history only works inside a git repository.',
    gitLogFailed: 'git log failed: {details}',
    hookNotGit: 'Not a git repository. Run git init first.',
    hookExists: 'Another pre-commit hook already exists: {path}\nRun with --force: the old hook will be saved as pre-commit.backup.',
  },

  cli: {
    hookBackup: 'Old hook saved: {path}',
    hookInstalled: '✅ pre-commit hook installed: {path}',
    hookExplain: 'Staged files are now checked before every commit. The commit is blocked on critical and high findings.',
    hookRunner: 'Runs the scanner from node_modules/.bin/vibe-scanner if the package is installed in the project, otherwise via {runner}.',
  },

  // Texts inside the hook shell script: no quotes or backticks
  hook: {
    installedBy: 'Installed by: vibe-scanner install-hook',
    notFound: 'vibe-scanner: scanner not found — check skipped.',
    install: 'Install it in the project: npm install -D {package}',
    blocked: '⛔ Commit blocked: vibe-scanner found critical problems (see above).',
    blockedFix1: '   Fix them and git add again. If it is a false positive,',
    blockedFix2: '   add the path to .vibescanignore.',
    npmError1: '   (If there is an npm error above rather than findings, check your connection or install the package:',
    npmError2: '   npm install -D {package})',
  },
};
