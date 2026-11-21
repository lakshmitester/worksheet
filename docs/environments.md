# Environments

No secrets in this file. Keys live in `.env.local` (gitignored) and in Vercel project settings.

|                    | Staging                                      | Production                                |
| ------------------ | -------------------------------------------- | ----------------------------------------- |
| Supabase project   | `worksheet-staging` (`gbgszkedleypscimagfr`) | `worksheet-prod` (`bggbkxopeeexfxxccxfl`) |
| Supabase region    | eu-west-2 (London)                           | eu-west-2 (London)                        |
| Vercel environment | Preview + Development                        | Production                                |
| App URL            | per-PR preview URLs                          | https://worksheet-silk-xi.vercel.app      |

- **GitHub:** https://github.com/lakshmitester/worksheet (private). CI runs in GitHub Actions.
- **Vercel:** project `lakshmi-tetali/worksheet`, connected to GitHub. A push to `main` deploys production, and a pull request gets a preview. Functions run in `lhr1`.
- **Supabase CLI:** linked to **staging**. Before applying migrations to prod, run `supabase link --project-ref bggbkxopeeexfxxccxfl`, then link back to staging afterwards.
- **Vercel env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (sensitive) are set per environment.
- **Free plan:** the projects pause after about a week of inactivity. Move prod to a paid plan, with PITR, before the pilots start.
