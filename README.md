# Worksheet

Multi-tenant SaaS for UK English tuition centers: branded 11+ worksheets as PDFs and zero-login live assessments with automatic scoring.

- Requirements: `BRD for this....pdf`
- Architecture review and build plan: `concepts_brief.md`
- Decision log: `docs/decisions.md`

## Stack

Next.js 16 (App Router) on Vercel (`lhr1`), Supabase Postgres 17 (London) with RLS from migration 001, Zod, Vitest, Playwright, pgTAP. Node 22 is pinned through `devEngines`, and pnpm downloads it automatically.

## Prerequisites

- pnpm 12
- Docker Desktop, needed for the local Supabase stack (`supabase start`, `db reset`, `test db`)

## Getting started

```bash
pnpm install
cp .env.example .env.local      # fill in from `pnpm exec supabase status`
pnpm exec supabase start
pnpm dev
```

## Scripts

| Script                         | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `pnpm dev` / `build` / `start` | Next.js                                                    |
| `pnpm lint` / `typecheck`      | ESLint (flat config) / `tsc --noEmit`                      |
| `pnpm test`                    | Vitest unit tests                                          |
| `pnpm e2e`                     | Playwright (starts the dev server automatically)           |
| `pnpm db:reset`                | Rebuild the local DB from migrations + `supabase/seed.sql` |
| `pnpm test:db`                 | pgTAP tests in `supabase/tests`                            |
| `pnpm db:types`                | Regenerate `src/lib/database.types.ts`                     |

## Rules worth knowing

- Schema changes go only through `pnpm exec supabase migration new <name>`. Every migration must be expand/contract compatible with the previous release.
- Service-role code lives only in `src/server/privileged/*`. ESLint blocks imports of it from anywhere else.
- No deploys during UK peak windows: weekdays 15:30-20:30, Saturday 08:00-14:00.
