# How to fix each finding

| Finding (`ruleId`) | What to do |
|---|---|
| A key in code (`openai-key`, `anthropic-key`, `stripe-live-key`, `aws-access-key`, `github-token`, `supabase-secret-key`, `private-key`, …) | Move it to a **server-only** env variable (no `NEXT_PUBLIC_` / `VITE_` prefix), read it with `process.env.NAME` in server code, add the name to `.env.example` without the value. Then tell the user they **must rotate the key** in the provider's dashboard — you can't do that, and the old key may already have leaked. |
| `public-env-secret` | Rename the variable without the public prefix and move the code that uses it to the server (API route, server action, edge function). |
| `supabase-service-role` | The browser must use only the anon key. Move privileged operations to server code that reads the service key from an env variable. Tell the user to reset the key. |
| `env-file-committed` | `git rm --cached <file>`, add `.env*` and `!.env.example` to `.gitignore`. Every key from that file must be rotated. |
| `gitignore-missing-env` | Add `.env`, `.env.*`, `!.env.example` to `.gitignore`. |
| Anything with `source: history`, `env-file-in-history` | Rotation is the fix. Rewriting history (git filter-repo) only after rotation and only with the user's OK. |
| `rls-not-enabled` | Write a **new** migration: `alter table … enable row level security;` plus policies based on `auth.uid()`. Never edit migrations that were already applied. |
| `permissive-policy` | Replace `true` with a real condition. For read-only policies, ask whether the data is meant to be public (blog posts) or not (profiles). |
| `rls-unverified` | The table was created outside migrations. Ask the user to check RLS in Supabase (Table Editor or Security Advisor), or add a **new** migration with `alter table if exists public.<table> enable row level security;` (safe to repeat). First check the browser does not query the table with the anon key — without policies those queries stop working ([fix.md](fix.md), "Tables without verified RLS"). |
| `hardcoded-secret`, `stripe-test-key`, `google-api-key` | Check with the user; move real secrets to env variables; restrict Google keys in Google Cloud Console. |

Where to rotate a key — name the place, the user does it themselves:
OpenAI → platform.openai.com → API keys · Anthropic → Claude Console → API Keys ·
Stripe → Dashboard → Developers → API keys · AWS → IAM → Security credentials ·
GitHub → Settings → Developer settings → Tokens · Supabase → Project Settings → API Keys.
