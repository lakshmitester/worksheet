# Institutional English Worksheet & Live Assessment SaaS: Single-Developer Architecture for Phases 1-4

* **Author:** vijay tetali
* **Date:** 2026-11-14
* **Mode:** Brainstorm (multi-lens concept brief)

| Reviewer lens | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-codebase-details` | completed |
| `egm-zoom-out` | completed |
| `egm-comprehension` | completed |
| `egm-implementation-readiness` | completed |
| `egm-structural` | completed |
| `egm-inventive-catalyst` | completed |

Cost, throughput and vendor-limit figures in this brief are reviewer estimates. Verify them against current vendor documentation before relying on them.

## Overview

The product is a multi-tenant SaaS for commercial English tuition centers. Tutors assemble exam-style worksheets, download them as branded PDFs, and run zero-login live tests in which each student's answers are scored automatically. Market order is UK 11+ (GL Assessment style) first.

The anchored hypothesis under review:
- one Next.js app on Supabase (London region), with Row-Level Security (RLS) keyed on `center_id` from the first migration;
- worksheets built from a pre-checked shared item bank plus tenant-private items, each generated, checked by a second LLM pass and stored individually;
- a branded PDF rendered once with Typst and cached;
- live sessions that save each answer over plain HTTP;
- Stripe Billing deferred until after 3-5 pilot centers.

All seven reviewers accept the base shape: one app, one Postgres database, RLS from day one, a UK-first launch and deferred billing. They do not accept the hypothesis as complete. Eight decisions are missing, and a coding agent would otherwise make them silently:
1. how guest students write to the database without bypassing RLS;
2. where background jobs run (Upstash Redis is not a durable queue);
3. an immutable versioning model for items, answer keys and worksheets;
4. an entitlements model that covers manually invoiced pilots;
5. the full PDF cache key and how Typst receives tenant and LLM text;
6. cloze scoring and normalisation rules;
7. release thresholds for generated content;
8. a migration, environment and deploy policy (the repo is not yet under version control).

The largest simplification on the table is whether tenant-private on-demand generation is needed before Phase 3. Removing it removes the job queue from the request path, most generation-quota logic, and most of risks 1 and 5 during the pilots.

## Analysis

### 1. Repository and platform baseline

The scaffold at `D:\Claude\myworks\worksheet` contains only `src/app/layout.tsx` and `src/app/page.tsx`. What it is missing:
- **Project setup:** no git repository, no `supabase/` folder (`supabase init` has not been run), no CI, no `.env.example`, no vitest or playwright config, and no `middleware.ts` or `instrumentation.ts`.
- **Packages:** none of these is installed yet: `stripe`, an LLM SDK, a Typst package, `server-only`, a queue client, telemetry, or an SVG sanitiser.
- **Scripts and naming:** the package is still named `app`, and there are no `typecheck`, `test`, `test:db` or `e2e` scripts.

Platform facts that affect the design:
- **Turbopack build.** `"build": "next build --turbopack"` is a beta production build in Next 15.5. The Typst function depends on native or WASM modules, `serverExternalPackages`, and `outputFileTracingIncludes` for font files, and those are the least mature parts of a Turbopack build. Use plain `next build` until a Typst function deploys successfully, or start on Next 16 (stable Turbopack builds; `middleware.ts` becomes `proxy.ts`). Decide this before writing auth middleware.
- **Node version.** Node 20 reached end of life in April 2026. Pin Node 22 or 24 in `engines` and in the Vercel project settings.
- **Vercel region.** The default function region is iad1 (US East), but the database is in London. Each database round trip would cross the Atlantic, at roughly 70-80 ms and several times per request. Set `regions: ["lhr1"]`, and put Upstash in the EU as well.
- **Local Supabase.** `supabase start` and `supabase test db` need Docker Desktop on this Windows host.
- **Email.** Supabase's built-in SMTP allows only a few emails per hour, so verification and tutor-invite emails will fail during pilots. Configure custom SMTP (Resend, Postmark or SES) before Phase 2.

### 2. Data model (Phase 1 must land this)

There are three reasons to fix the data model now:
- A GL-style comprehension task is one passage with 8-12 questions that depend on it, so the item model needs a parent passage.
- Answer keys must be correctable without rewriting what students already saw.
- Phase 3 and Phase 4 add exam formats, quotas and billing.

All three are cheap to model now and expensive to retrofit later.

- **Tenancy**
  - `centers(id uuid, name, region, stripe_customer_id null, ...)`. Store `region` from migration 001 and use UUIDs everywhere, so a Phase 4 region split needs no re-keying.
  - `memberships(user_id, center_id, role in ('owner','tutor'), status)`, many-to-many from day one. This covers tutors who work at two centers and the BRD's later "multi-branch" requirement.
  - `platform_admins(user_id)`. It is never checked inside tenant RLS policies.
- **Reference data:** `exam_formats`, `skills` (per format), `difficulty_scales` (UK school year plus a tier for 11+; CEFR and US grade do not fit), and `locales` (en-GB first; locale affects spelling and therefore answer keys). These are lookup tables, not Postgres enums, and Phase 1 seeds one row of each.
- **Content (immutable revisions)**
  - `passages` and `passage_versions(text, content_hash, provenance)`.
  - `items(id, center_id null, visibility in ('shared','tenant'), exam_format_id, skill, status in ('active','quarantined','retired'), origin in ('bank','on_demand'))`.
  - `item_versions(item_id, version, passage_version_id null, item_type, schema_version, content jsonb, content_hash, gen_model, gen_prompt_version, verifier_model, verification jsonb)`.
  - `item_version_keys(item_version_id, key, accepted_answers, normalisation_policy_version)` in a **separate table**. If the key lives inside `content`, any student can read it in the browser's network tab.
  - A trigger rejects UPDATE on version and key rows. To correct a key, insert a new version, or add an `answer_key_errata` row (see section 5).
- **Worksheets**
  - `worksheets` (mutable draft) and `worksheet_versions` (immutable once frozen).
  - `worksheet_version_items(position, item_version_id)`.
  - Live sessions and PDFs always reference a `worksheet_version_id`. Flag-and-replace always creates version n+1, and sessions already running stay on version n.
- **Brand and rendering**
  - `brand_versions`, immutable, with logo assets at content-addressed Storage paths.
  - `pdf_renders(worksheet_version_id, brand_version_id, variant in ('student','key'), template_version, typst_version, font_bundle_version, status, storage_path)`.
- **Live sessions**
  - `sessions` (owned by the tutor): `token_hash`, `status` (`open`, `locked` or `closed`), `closes_at`, `grace_until`, `max_participants`.
  - `participants` (one per student attempt): `alias`, `device_secret_hash`, `submitted_at`.
  - `responses(participant_id, position, item_version_id, answer_raw, client_seq, client_ts, server_ts)`, unique on `(participant_id, position)`.
  - Scores are derived from responses joined to the pinned key. They are never the stored source of truth.
- **Usage and billing**
  - `jobs`
  - `llm_calls(provider, model, purpose, tokens, cost, latency, outcome)`
  - `usage_ledger`
  - `entitlements(center_id, tier, source in ('manual','stripe','trial','grace'), valid_until, ...)`
  - `stripe_events`
  - `billing_subscriptions`
  - `entitlement_audit`

Cloze items need `accepted_answers[]` plus a versioned normalisation policy:
- trim and case-fold;
- straight vs curly quotes;
- UK/US spelling variants only where both are valid answers;
- no edit-distance tolerance unless the author decides otherwise.

Scoring is a pure function in `src/lib/scoring.ts`, covered by table-driven tests. Answer formats specific to GL papers, such as A-E options, "N" for no mistake, and segmented lines for spelling and punctuation questions, are separate `item_type` values in a Zod discriminated union keyed on `item_type` plus `schema_version`. Old rows are upcast when read, never rewritten.

### 3. Tenant isolation and the RLS policy shape (risk 3)

- **Where `center_id` comes from.** Look it up from memberships, not from a JWT claim. A claim set by a Custom Access Token Hook only changes when the token refreshes (about 1 hour by default), so a removed tutor keeps access until then. A single claim also cannot represent a tutor with two centers.
- **Helper function.** `private.user_center_ids()` returns `uuid[]`. It is `STABLE`, `SECURITY DEFINER` and `SET search_path = ''`, it lives in a schema PostgREST does not expose, and EXECUTE is granted to `authenticated` only.
- **Policy pattern.** Use `USING (center_id = ANY ((select private.user_center_ids())))`. The subselect makes Postgres evaluate the helper once per statement rather than once per row. Index every `center_id`.
- **Shared bank**
  - SELECT allows `center_id IS NULL OR center_id = ANY(...)`.
  - INSERT, UPDATE and DELETE allow only `center_id = ANY(...)`. Because `NULL = ANY(...)` denies, tenants cannot write bank rows.
  - Write one policy per command and never use `FOR ALL`. The realistic way the bank gets poisoned is someone copying the SELECT predicate into a write policy.
  - A CHECK ties `visibility = 'shared'` to `center_id IS NULL`, so a bug that writes NULL fails loudly. Without it, the bug would quietly publish a tenant's item to every tenant.
- **Cross-tenant reference trigger.** A trigger on `worksheet_version_items` requires the referenced item's `center_id` to be NULL or equal to the worksheet's own center. Without it, a "replace item" endpoint running with elevated rights will accept another tenant's `item_version_id` and render it into the wrong center's PDF. RLS cannot prevent this, because the privileged path skips RLS.
- **Privileged code**
  - The service-role or secret key is created in one module that starts with `import 'server-only'`. A lint rule allows that module to be imported only from `src/server/privileged/*` (webhooks, workers, bank seeding).
  - Workers take `center_id` from the job row, never from LLM output or the request payload, and they write through `SECURITY DEFINER` functions that check ownership.
  - Server actions are public POST endpoints, so each one re-checks auth and role.
- **Storage.** Paths are `{center_id}/...`, with `storage.objects` policies on the first folder segment. PDFs sit in a private bucket and are served by short-lived signed URLs. Logos upload directly to Storage through signed upload URLs, which avoids the 1 MB server-action body limit.
- **CI guards (week 1)**
  - Fail the build if any `public` table has RLS disabled or no policy.
  - Fail the build if any view lacks `security_invoker = true`.
  - Fail the build if any `SECURITY DEFINER` function is missing from a reviewed allowlist.
  - Run a pgTAP matrix through `supabase test db`, using basejump's supabase-test-helpers. It covers every table and every command for each actor: own-tenant tutor, own-tenant owner, other-tenant tutor, anon, a live guest from another session, and the service role. It includes the shared-bank write negative tests and Storage.
  - Run a Vitest integration test with two real users. Vitest alone cannot prove RLS, so the pgTAP matrix is still required.
  - Run `supabase db lint` and the Security Advisor.

Failure scenarios for risk 3:
1. **Privileged-path IDOR.** The cross-tenant reference trigger prevents it.
2. **Leaking view.** A convenience view or materialized view built without `security_invoker` returns every tenant's rows. The CI guard prevents it, as does keeping materialized views in `private` behind filtering RPCs.
3. **Stale JWT access.** A removed tutor keeps access until the token refreshes. The membership lookup prevents it, and a test checks that access is denied on the next request after removal.
4. **Bank poisoning.** A write policy reuses `IS NULL OR` and a tenant writes into the shared bank. Per-command policies and negative tests prevent it.

### 4. Content pipeline: generation, verification and queueing (risks 1 and 5)

**Where background work runs.** Upstash Redis lists give no acknowledgement, no visibility timeout, no retry and no dead-letter queue. Vercel also has no long-running consumer to read from them. `after()` is fire-and-forget, not durable. All seven reviewers converge on a Postgres-backed queue:
- **Table:** `jobs(id, center_id, kind, payload, idempotency_key unique, status, attempts, max_attempts=3, run_after, locked_until, last_error)`.
- **Claiming:** jobs are claimed with `FOR UPDATE SKIP LOCKED`. Job state commits in the same transaction as the item rows it produces.
- **Triggering:** `after()` on enqueue, plus a Vercel Cron or `pg_cron` sweeper every minute that re-queues expired locks. QStash or Upstash Workflow is the documented fallback for durable step execution.
- **Per-item checkpoints:** each item is written as soon as it passes. A 30-item job that hits the function time limit at item 18 then resumes instead of paying again for items 1-17.
- **What Redis is still for:** rate limiting only.

**Bank generation is not a production feature.** Run it as a local CLI script using the providers' batch APIs, which are roughly half price and have no latency target. Its output is reviewed by a human and then written with `center_id NULL` through the service role. In-app work becomes assembly: filter the bank by format, skill, difficulty and topic. Assembly is deterministic, takes under a second, and costs nothing per request.

**Verification as a defined checklist.** "The second pass matches the key" measures whether two models agree, not whether the item has exactly one correct answer. The pipeline:
1. **Strict JSON.** The LLM returns JSON validated by Zod 4. `z.toJSONSchema()` output must be fitted to the provider's strict-mode subset:
   - every property required, with optional fields made nullable;
   - `additionalProperties: false`;
   - limited support for `pattern` and `minItems`.

   `.refine()` checks are dropped from JSON Schema, so they run as a Zod parse after generation. Use the Vercel AI SDK (`ai` with `generateObject`), which supports Zod 4 and switching providers.
2. **Deterministic gates (no LLM cost)**
   - options are unique after normalisation and the key is one of them;
   - the key does not appear verbatim in the question stem;
   - the cloze answer fits the gap's word count;
   - a comprehension item's `evidence_quote` is an exact substring of the passage text;
   - a "find the misspelt word" item has exactly one option that fails an en-GB hunspell check.
3. **Blind verifier.** A different model family, at temperature 0, that never sees the key. It returns its own answer and, separately, every option a competent examiner could defend. Reject the item if it disagrees, if more than one option is defensible, or if its confidence is low. It also checks that the passage is needed to answer and that the content suits ages 10-11. A moderation call runs on every passage.
4. **Disagreement handling.** Items that disagree are discarded, never "fixed" by the LLM. Retries are capped at 3, then the item is dead-lettered.
5. **Provenance.** `gen_model`, `gen_prompt_version`, `verifier_model`, the verifier's answer, the match result and the job id are stored on every item version.

**Release thresholds** (proposed, author to confirm):
- **Golden and mutation sets.** At least 50 hand-written items per Phase 1 item type with known keys, growing to 200, plus a mutation set: the same items with wrong keys, and MCQs where a distractor is also defensible.
- **Verifier pass mark.** The verifier must reject at least 99% of the mutations and wrongly reject at most 5% of the golden items. Run this nightly and on every prompt or model change, and block the change if the catch rate drops.
- **Batch gate.** Quarantine any batch where generator and verifier disagree on more than 15% of items, which indicates the prompt or model has drifted.
- **Human sampling before a bank release (rule of three).** Zero defects in n sampled items bounds the error rate at about 3/n with 95% confidence. So sample 300 items, stratified by item type and skill, for a 1% or lower wrong-key target, or 600 items for 0.5%. One defect means the batch is rejected or the sample doubled. Results are recorded in `item_reviews`.

**Risk 1 failure scenarios and mitigations**
1. **Errors the two models share.** "Closest in meaning to BRISK: quick / lively / cold / sharp". Both models pick "quick", but "lively" is also defensible, and tutors dispute the key in front of a class. Mitigations:
   - a verifier from a different model family;
   - the "any other defensible option" prompt;
   - human sampling of the bank;
   - **live item statistics** as a second, free verifier: after N responses, compute item difficulty (the p-value) and the point-biserial for each option, and quarantine the item automatically if strong students keep choosing a "distractor".
2. **Stale key after an in-place fix.** Cached PDFs and past scores keep the old key, and nobody can tell which scores were wrong. Mitigation: immutable versions plus an erratum or new version. A `regrade(item_id)` job rescores responses pinned to the old version, records `scored_with_key_version`, notifies the tutors who issued that version, and invalidates their renders.
3. **Bad item in production.** An item flagged by 2 or more distinct centers, or once by the platform admin, is quarantined from new worksheets. Sessions already running continue on their pinned version and are regraded when the fix lands. Alert if the flag rate exceeds 2 per 1,000 items served.

Tenant-private on-demand items get no human sampling. If they are kept, the UI must label them "AI-checked, not human-reviewed", and the author must decide whether they can be used in live sessions.

**Risk 5 failure scenario (generation).** A 30-item comprehension worksheet with blind verification and about 30% rejections is 40-60 LLM calls, at 8-20 s each. That exceeds a single function's duration limit. The tutor retries and you pay twice. Mitigations:
- assemble from the bank by default;
- checkpoint each item, keyed by `idempotency_key`;
- show progress in the UI ("12/30 verified");
- block publishing (DB-enforced) until every item on the worksheet is verified.

The 8 s target is then met by assembly. Generation is never on the hot path.

### 5. PDF rendering with Typst (risk 5)

- **Where Typst runs.** In a Vercel Node-runtime function in lhr1, using `@myriaddreamin/typst-ts-node-compiler`. This is a native N-API addon with linux-x64 prebuilt binaries. The hypothesis named "@myriaddings", which is not the correct package scope. The native addon is faster than the WASM `typst-ts-web-compiler` and can load font files from disk.
  - Mark it as a server-external package.
  - Bundle the OFL-licensed font files through `outputFileTracingIncludes`.
  - Pin the Typst version.
  - Fallback if bundle size or cold start fails the Day 3 spike: one small container (Cloud Run or Fly) running the Typst CLI.
- **When it runs.** Render both the student and key variants as a background job when a worksheet version is frozen or a brand version is created. Render on request only on a cache miss, showing a "preparing" state. Every download is then a signed Storage URL.
- **Cache key.** `sha256(worksheet_version_id, brand_version_id, variant, template_version, typst_version, font_bundle_version)`, stored at `<center_id>/pdf/<key>.pdf`. Without `template_version`, a template bug fix never reaches cached PDFs.
- **Typst injection (Blocker-class).** Never build Typst source by joining strings. Pass all tenant text (headers, footers, center name) and all LLM text as data, through `sys.inputs` or a JSON file read with `json()`.
  - Generated text containing `$`, `#`, `*` or `@` would otherwise switch into math mode, create references, or fail to compile.
  - A tenant footer such as `#read("...")` would run as code.
  - Keep a corpus of hostile strings as a CI render test.
- **One source document.** A single `WorksheetDocument` JSON feeds both the Typst template and the React live player, through two projections: `student`, with keys stripped by one unit-tested function, and `teacher`. The student PDF and the live player both consume only the `student` projection. That removes a whole class of key leaks.
- **Watermark.** Static per center, so it is part of the brand. If it ever becomes per-student (to trace leaked copies), stamp an overlay (pdf-lib) onto the cached base PDF rather than adding it to the cache key.
- **Logos**
  - Sanitise SVG on upload: strip scripts, `foreignObject` and external hrefs. Then rasterise it or reject SVG features Typst does not support.
  - Cap the size (about 500 KB) and re-encode PNGs.
  - Pass the bytes to Typst through its virtual filesystem.
  - Typst's SVG renderer (usvg) ignores scripts, so the PDF itself is not the risk. The risk is the same SVG shown in the web UI (XSS).
- **Tests**
  - Golden-file tests use a fixed document date. Each page is rasterised and pixel-diffed against a committed image (threshold 0.1% or less).
  - Text-extraction checks: the key appears only in `variant=key`, the watermark only in `variant=student`, and the center name and accent colour are present.
  - Fixtures: a passage that overflows a page, a wide SVG logo, the longest center name allowed, and non-ASCII text.
- **Latency target.** Restate PDF-03 as two targets: a cached fetch at p95 under 300 ms, and a first render at p95 under about 10 s, measured on the chosen runtime. Typst compilation is synchronous and CPU-bound, so on Fluid compute several renders share one instance's event loop. The "150 parallel renders" requirement therefore applies only to the burst after a brand edit, and it should go through the queue.

Risk 5 failure scenario (PDF): a cold function loads the compiler and about 5 MB of fonts and compiles 4 pages on the request path, at 9 a.m. on exam day. Pre-rendering when a version is frozen moves that cost off the request path.

### 6. Live session write path (risk 2)

Real answer loss comes from classroom Wi-Fi, refreshed tabs and deploys, not from database throughput.

Load estimate: 2,400 students answering 30 items over 30 minutes averages about 40 writes/s. A peak of 120 writes/s, including answer changes and retries, is plausible. A single-row upsert inside an RPC costs a few milliseconds of database time, provided requests go through PostgREST or Supavisor in transaction mode (port 6543, `prepare: false`) and never through direct connections.

- **Guest identity (decide before the Phase 2 schema).** The recommended pattern:
  - The live token authorises only `join_session(token, alias)`.
  - That call returns a participant id plus a `device_secret`, which is kept in localStorage. A reload or a sleeping tablet then rejoins as the same participant.
  - Every later call is a `SECURITY DEFINER` RPC that hashes the token, checks session status and the time window, and touches only that session's rows:
    - `get_session_payload(token, device_secret)`
    - `submit_answer(...)`
    - `submit_final(...)`
  - Guests have no table policies at all, and the service-role key is never used on this path.
  - For a device change, the student's screen shows a 4-6 character rejoin code that the tutor approves.
- **Transport.** Two options are open:
  - **Recommended:** the browser calls the Supabase RPC directly with the publishable key, skipping the Vercel hop. This means fewer failure points and no function invocation per answer.
  - **Alternative:** a Next route handler that calls the same RPC, which allows Vercel WAF rules and versioned paths such as `/api/live/v1/answer`.

  Do not use a server action: React runs client-dispatched actions one at a time, so one slow save delays the next.
- **Middleware.** Exclude `/live`, `/api/live/*` and `/api/stripe/webhook` from the `@supabase/ssr` middleware matcher. Otherwise each answer triggers an Auth refresh call, which would mean hitting Auth rate limits at 120 writes/s, and guests and Stripe get redirected to the login page. In server code use `getClaims()` with asymmetric signing keys, never `getSession()`.
- **Idempotent, ordered upsert.** `ON CONFLICT (participant_id, position) DO UPDATE ... WHERE responses.client_seq < EXCLUDED.client_seq`. A late retry cannot overwrite a newer answer. Scoring happens inside the RPC, against `item_version_keys`.
- **Client outbox**
  - Every answer goes to IndexedDB first, holding the latest record per position.
  - The flusher sends a batch after a 1-3 s debounce or when the student moves to another item.
  - Retries use exponential backoff with jitter, capped at 30 s.
  - The outbox also flushes on `online`, `visibilitychange` and `pagehide` (using `sendBeacon`).
  - The UI shows "Saved" or "N pending".
  - `submit_final` sends a full snapshot of the student's answers, and the server reconciles it, repairing any individual writes that were lost.
- **Closing and grace period.** "End session" sets `status='closed'` and `grace_until = now() + a few minutes`. During grace, writes with `client_ts < closed_at` are accepted. The End control warns "3 students have unsaved answers".
- **Timing.** Deadlines are enforced by the server. Late answers are stored and marked late, and the tutor decides what to do with them.
- **Rate limiting.** Never rate-limit by IP alone: a class of 40 shares one school NAT address. Limit `join_session` by session plus IP with a generous limit, and enforce `max_participants` in the database. Answer writes are bounded inside the RPC (number of positions, `client_seq` growth) rather than by a Redis call on every write. That avoids adding a second vendor to the most critical path.
- **Link abuse.** Use 128-bit random tokens, stored hashed. The tutor can lock joins and remove aliases, because a link pasted into a parents' WhatsApp group would otherwise let strangers join.
- **Dashboard**
  - Poll a `session_heatmap(session_id)` function every 3-5 s. It returns about 1,200 cells per session and short-circuits on `max(server_ts)`. Sixty tutors polling is about 15 requests/s.
  - Do not use Realtime `postgres_changes`: it checks RLS for each subscriber on every change, and the Supabase docs say it does not scale at this write rate.
  - Do not keep counter rows updated by triggers, which become a contention hotspot when 40 students write at once.
  - If push is needed later, use Realtime Broadcast on one private channel per session, fed by a throttled trigger.
- **Deploys.** Vercel rollback does not roll back the schema, and a student mid-test keeps running the old JavaScript bundle. So:
  - Migrations follow expand/contract only: every migration works with release N-1 of the code.
  - Version the live API.
  - Freeze deploys during UK peak windows: weekdays 15:30-20:30 and Saturday 08:00-14:00.

Risk 2 failure scenarios and mitigations:
1. **Shared-IP lockout.** An IP-keyed limiter returns 429 responses mid-test. Mitigation: per-session limits and visible retries.
2. **Writes rejected at close.** Mitigation: the grace window plus final-snapshot reconciliation.
3. **Deploy mid-session.** Mitigation: expand/contract migrations, a versioned API and freeze windows.
4. **School device clears storage.** Mitigation: the "N not yet saved" indicator plus `submit_final`.
5. **Provider outage of a few minutes.** The outbox turns it into a delay, not data loss. The player shell and the worksheet JSON are cached when the session starts.

**Load-test gate (Phase 2).** Use k6 against staging, on the same compute tier as production:
- Scenarios:
  - (A) 2,400 students join within 60 s;
  - (B) 120 writes/s for 20 minutes;
  - (C) 180 writes/s;
  - (D) 10% of virtual users drop for 60 s and then replay their outbox.
- Pass criteria: p95 write latency under 300 ms, an error rate after retries under 0.1%, and a SQL count that exactly matches the acknowledged idempotency keys.

Playwright covers the browser-level cases: going offline and answering, aborting the response after the server has committed, reloading and resuming, and closing the session while a client is offline.

### 7. Entitlements, Stripe and quotas (risk 4)

- **Entitlements from Phase 1.**
  - Every feature and quota check reads only `private.center_entitlement(center_id)`, which is backed by `entitlements`. No code checks a plan name or a Stripe status directly.
  - Phase 2 pilots get rows with `source='manual'`, written by the developer.
  - Phase 3 adds Stripe as a second writer to the same table, so no reader changes.
  - A pilot moves over by attaching a subscription. The manual row stays authoritative until the first successful `invoice.paid`.
- **Webhook route**
  - Node runtime; read the raw body with `await req.text()`, then call `stripe.webhooks.constructEvent`.
  - Deduplicate with `stripe_events(id pk)` and `ON CONFLICT DO NOTHING`.
  - Ignore payload ordering. On any `customer.subscription.*` or `invoice.*` event, re-fetch the subscription from the Stripe API and project its current state through a pure `deriveEntitlement(subscription)` function.
  - Table-test that function against every subscription status, plus `cancel_at_period_end`.
- **Customer mapping.** Create the Stripe Customer when the center is created, with `metadata.center_id`. Set `client_reference_id = center_id` on Checkout.
- **Asymmetric failure.** "Paid but locked out" does more damage than "cancelled but still active". So:
  - When the state is uncertain, extend access with a `grace` row rather than revoking it.
  - `past_due` keeps access for 7 days.
  - Revocation takes effect at the end of the billing period, never mid-session. A live test is never cut off by billing.
- **Reconciliation.** A nightly cron lists active Stripe subscriptions and diffs them against `entitlements`, alerting on any drift. Owners get a "Resync billing" button. Every change is written to `entitlement_audit` with its cause.
- **Scope cuts for Phase 3.** Use Stripe Checkout and the Customer Portal (no custom billing UI), GBP prices only, and Stripe's own `trial_period_days`. Tier prices live in Stripe Price IDs, and entitlements map from a tier key, never from an amount.
- **Quotas**
  - **Unit:** one generated item that passed verification. Tenants understand items, and items are what can be priced.
  - **Not counted:** bank pulls, failed verification attempts and flag-and-replace.
  - **Enforcement:** reserve, then settle. On enqueue, inside one transaction:
    1. take `pg_advisory_xact_lock(hashtext(center_id::text))`;
    2. sum reserved plus settled units for the period;
    3. compare against the entitlement limit;
    4. insert a reserved row.

    When the job finishes, settle the number of verified items and release the rest. Without the lock, two parallel requests can both pass the check.
  - **Pilots:** a crude hard cap per center from the usage ledger.
  - **Platform circuit breaker:** stop all on-demand jobs if `sum(llm_calls.cost)` today exceeds a set ceiling. Also set spend caps in both LLM provider consoles, and keep a global kill switch.
- **Illustrative cost (unverified).** Roughly 2 cents per verified item, or $0.50-0.80 for a 30-item on-demand worksheet. Keeping a $29 tier's LLM cost under about 20% of revenue implies about 250-300 on-demand items a month.
  - Proposed starting quotas: Solo 250, Standard 1,200, Enterprise 4,000 items a month.
  - Bank items are unmetered, and the bank is the main lever on margin.

Risk 4 failure scenarios and mitigations:
1. **Pilots locked out on Phase 3 launch day** because they have no subscription row. Mitigation: manual entitlements.
2. **Out-of-order cancel.** A `subscription.deleted` event arrives after the new subscription's `created` and deactivates a paying center. Mitigation: re-fetch the canonical state on every event.
3. **Orphan payment.** Checkout completes but the webhook cannot map the customer to a center. Mitigation: create the customer up front and run the reconciliation job.
4. **Downgrade mid-period** drops the quota while a job is running. Mitigation: reservations are settled against the limit that applied when the job was enqueued.

### 8. Privacy, operations and observability

- **Children's data (entry gate for Phase 2)**
  - Write a DPIA and a DPA with each pilot center.
  - Record every field captured per attempt.
  - A `pg_cron` purge job pseudonymises `participants.alias` (to "Student 14") N days after a session closes, keeping the scores.
  - Topics come from a picklist, not free text, for Phases 1-3. Free text is both a prompt-injection path and a route to unsuitable content.
- **"Student tracking" contradiction.** The Tutor role promises student tracking, but guest aliases cannot link one student across sessions. Choose one:
  - (a) results per session only;
  - (b) a tutor-managed roster of pseudonymous codes (recommended);
  - (c) real student records, which changes scope and Children's Code exposure.

  The choice fixes the shape of the `participants` table.
- **Environments**
  - Run `git init` and `supabase init` on Day 1.
  - Use two London Supabase projects, staging and prod. Vercel Preview points only at staging.
  - Schema changes happen only through `supabase migration new`, and CI runs `supabase db reset` from zero on every push.
  - Generate types with `supabase gen types`.
  - PITR is a paid add-on with a minimum compute size. Budget for it, and run one documented restore drill before Phase 2.
- **Observability**
  - **Errors:** `@sentry/nextjs`, with a `beforeSend` scrubber that drops request bodies on `/live` routes.
  - **Logs:** structured JSON shipped to Axiom or Better Stack, each line carrying `center_id`, `job_id` or `session_id`, and `request_id`.
  - **Tracing:** OpenTelemetry trace context carried through job payloads.
  - **Metering:** `llm_calls` per call, priced from a versioned `model_prices` table.
  - **PDF metrics:** render time, cold start, and cache hit or miss for each render.
- **Alerts (pushed during UK prep hours)**
  - uptime checks on `/api/health` and on a synthetic live join-and-answer probe every 5 minutes;
  - live write error rate above 1% over 5 minutes;
  - oldest pending job older than 10 minutes;
  - daily LLM spend above 2x the trailing 7-day average;
  - webhook processing errors;
  - pool usage above 80%;
  - any reconciliation drift.

  The synthetic probe also exercises the fallback paths, for example a forced bank-only run.

### 9. Contradictions and inventive resolutions

| Contradiction | Resolution | Mechanism |
| --- | --- | --- |
| Thorough verification vs 8 s response | Separation in time; prior action | Bank filled off-peak through batch APIs. Hot path is assembly only. On-demand items show "verifying" and cannot be published until verified (DB-enforced). A nightly job generates items for the most frequent bank misses. |
| Correctable keys vs reproducing what students saw | Segmentation of key from content | Immutable `item_versions`; keys in their own table; errata rows; raw responses; scores derived; regrade job. |
| Two LLM passes can share an error | Using the harm as a resource | Live response statistics (p-value, point-biserial) act as a third verifier at no extra cost and quarantine suspect items automatically. |
| Zero-login vs durable, attributable answers | Prior cushioning | Device secret, IndexedDB outbox, `client_seq` upsert, final snapshot, grace window. |
| Tenant isolation vs shared bank vs privileged workers | Segmentation | `visibility` CHECK, per-command policies, cross-tenant reference trigger, service-role import allowlist, workers take `center_id` from the job row. |
| Rich branding vs fast PDF | Prior action; one source document | Render on freeze; full content-addressed cache key; logos normalised on upload; one `WorksheetDocument` with student and teacher projections. |
| Solo ops vs 99.9% across 5 vendors | Fewer parts; graceful degradation | Postgres queue (no Redis on critical paths); bank-only fallback when the LLM is down; cached PDFs served during outages; synthetic probe; sweeper for stuck jobs. |
| $29 tier vs LLM cost | Segmentation by provenance | Generic-parameter items can be promoted to the bank, so one tenant's paid generation serves all tenants. Items built from a tenant's own text are never promoted. Low tiers use the batch API with "ready in minutes". |
| Deferred billing vs correct entitlements later | Reversing the dependency | Entitlements table first; Stripe becomes one more writer. |
| One London database vs a Phase 4 region | Segmentation decided in advance | `centers.region`, region prefix in tokens and Storage paths, bank exportable by `content_hash`. |

Two reviewer proposals conflict:
- **Counter rows vs aggregate-on-read.** The inventive lens proposed `session_item_stats` counter rows; the design lens warned they become a write hotspot. The brief adopts aggregate-on-read, because about 1,200 cells per session is small. Counter rows are added only if measurements show a need.
- **Supabase anonymous sign-in for guests.** The inventive lens proposed it; the codebase lens noted that anonymous sign-ins are rate-limited per IP (default about 30 per hour, to be verified). A class behind one NAT address would hit that limit. The brief adopts token-plus-device-secret RPCs instead.

### 10. What a solo developer should cut or defer

| Cut or defer | Add back when |
| --- | --- |
| In-app tenant-private generation in Phases 1-2. Use the offline CLI bank plus assembly, and log unmet requests for overnight batch generation. | Telemetry shows assembly returning too few items, or pilots ask for topics the bank lacks and an overnight wait costs sales. |
| Upstash as a queue, and Redis on the answer path | Abuse that WAF and in-RPC checks cannot stop, or token-bucket quotas for in-app generation. |
| Supabase Realtime | Tutors report that a 3-5 s poll delay hurts teaching. |
| Super-admin UI. Use Studio, SQL and the Stripe Dashboard. | Around 50 or more centers, when operating through SQL becomes slower than building screens. |
| Microsoft OAuth. Use email (magic link or password) plus Google when self-serve signup starts. | A named customer requires it. |
| Branding beyond PNG/SVG logo, accent colour, center name and a one-line footer | A paying center asks for it. |
| Watermark variants | A center reports sheets being redistributed. |
| Free-text and fuzzy-graded answer types. Use MCQ and closed cloze only. | Deterministic scoring rules are defined. |
| Multi-currency and Stripe Tax. GBP only, with VAT following accountant advice. | The first paying customer outside the UK. Consider a merchant of record (Paddle or Lemon Squeezy) then. |
| BRD P4 items: custom domains, API access, multi-branch hierarchy. Many-to-many memberships already cover tutors at two centers. | An Enterprise customer pipeline exists. |
| 0.5 s render target and 150 parallel renders | Replaced by the cached-fetch and first-render targets. |
| Optional "Phase 0" concierge: deliver branded PDFs by hand from the CLI bank and the local Typst CLI to 2-3 centers for a few weeks | Validates content quality and willingness to pay before any app code. The templates and schema carry over. |

## Goals vs. Non-Goals

**Goals**
- No wrong answer key reaches students without being detected and corrected. Every scored response can be traced to the item version and key version used, and can be regraded.
- No acknowledged answer is lost. A school Wi-Fi drop, a tab reload, a deploy or a short provider outage during a live session causes a delay, not data loss.
- Tenant isolation is enforced by the database and checked in CI on every table, view, function and Storage bucket, including the privileged paths.
- Entitlements are correct from the first pilot. Moving from manual invoices to Stripe changes no feature code.
- Cached PDF downloads are Storage fetches. First renders and generation never run on the tutor's critical request path.
- One person can operate the system: few vendors, graceful degradation, a self-repairing job queue, and alerts sized for one person.
- Phase 1 schema accepts Phase 3 billing and a Phase 4 exam format or region with additive migrations only.

**Non-Goals**
- A 99.9% uptime SLO backed by multi-region failover. Replace it with journey-level resilience goals and best-effort availability tied to vendor status pages.
- A customer-facing Stripe test-mode toggle (PAY-02). Retire it; Stripe test mode is for internal development only.
- Lexile targeting, and reproducing exam past papers.
- Tutor editing of generated content. It stays read-only; tutors flag and replace.
- Real-time WebSocket push to every student or tutor.
- Global dashboard performance targets (FCP < 1.2 s "globally"). Restate as UK-only.
- NAPLAN or SAT before Phase 4.
- Native mobile apps; center operations (payroll, rooms, parent invoicing); non-English subjects.

## Alternatives Weighed

| Alternative | Outcome |
| --- | --- |
| Typst binary on AWS Lambda (BRD stack) | Rejected by author/ideation: adds a second cloud, IAM and deployment pipeline for one function. A native Node addon in a Vercel lhr1 function covers the need, with a single container (Cloud Run or Fly) as fallback if the Day 3 spike fails. |
| Typst WASM (`typst-ts-web-compiler`) on the server | Rejected by ideation as the default: multi-MB module and slower cold start than the native N-API compiler. It also needs fonts loaded on every cold start. |
| Typst WASM in the tutor's browser | Deferred by ideation: removes server compute, but means a payload of several MB on first use and two rendering environments to test. Revisit only if server rendering hits limits. |
| Multi-region database failover | Rejected by author/ideation: excessive for 250 tenants on Supabase, and needs replication and failover drills that one person cannot run. PITR backups plus degraded modes replace it. |
| Customer-facing Stripe test-mode checkout (PAY-02) | Rejected by author/ideation: test-mode and live-mode objects are disconnected, so a test checkout cannot become a live subscription. Use Stripe's own trial on live mode instead. |
| NAPLAN or SAT as the first exam format | Rejected by author/ideation: splits the content bank, prompts, templates and item types across markets before one is validated. UK 11+ fits the London region and UK GDPR. `exam_formats` reference tables keep Phase 4 additive. |
| Realtime connection per student, and `postgres_changes` for dashboards | Rejected by ideation: Realtime checks RLS for each subscriber on every change and scales poorly at 120 writes/s. Students don't need push. Tutors poll an aggregate function. |
| Upstash Redis lists as the job queue | Rejected by ideation: no acknowledgement, visibility timeout, retry or dead-letter queue; no transaction with item rows; no long-running consumer on Vercel. Replaced by a Postgres `jobs` table with `SKIP LOCKED`. QStash, Upstash Workflow or pgmq are the fallback. |
| Inngest or Trigger.dev for jobs | Rejected by ideation for now: another vendor. Reconsider only if the Postgres queue proves insufficient. |
| `center_id` as a JWT custom claim | Rejected by ideation: stale for up to the token lifetime after a tutor is removed, and cannot represent multi-center users. Replaced by a membership lookup in a `SECURITY DEFINER` helper. |
| Service-role key in the answer-save route | Rejected by ideation: bypasses RLS on the most-written table. Replaced by narrow `SECURITY DEFINER` RPCs. |
| Supabase anonymous sign-in per student | Rejected by ideation: per-IP sign-in rate limits conflict with a classroom behind one NAT address, and it creates thousands of `auth.users` rows to purge. |
| Per-participant custom JWT minted by the app | Deferred by ideation: workable, but adds signing-key handling. Token-plus-device-secret RPCs are simpler for Phase 2. |
| IP-keyed rate limiting on live routes | Rejected by ideation: a whole classroom shares one IP, so students would get 429 responses mid-test. |
| Redis write buffer in front of Postgres for answers | Rejected by ideation: adds a failure point on the most critical path. Postgres handles the load. |
| Trigger-maintained score counter rows | Rejected by ideation: a write hotspot under concurrent students. Aggregate on read. |
| Separate shared-bank and tenant item tables | Open (author decision): removes the nullable-column leak class, but needs union queries and two foreign-key targets in `worksheet_version_items`. The brief defaults to one table with a `visibility` CHECK, per-command policies and negative tests. |
| Editing answer keys in place | Rejected by ideation: leaves cached PDFs and past scores wrong with no trace. Immutable versions and errata replace it. |
| Same-model second pass as the only verifier | Rejected by ideation: both runs make the same mistakes. Use a blind verifier from a different model family plus deterministic gates, human sampling and live item statistics. |
| Building Typst source by string concatenation | Rejected by ideation: Typst markup injection and compile failures. All text passes as data. |
| Per-student watermarks in the cache key | Rejected by ideation: multiplies cached files by roster size. Static per-center watermark, or an overlay on the cached base. |
| Lexile-band targeting by LLM | Rejected by author/ideation: proprietary metric that LLMs cannot reliably hit. Use a UK school year plus a tier. |
| Per-tenant on-demand generation in Phase 1 | Deferred by ideation (author decision pending): the main source of queueing, quota and wrong-key risk during the pilots. |
| Stripe Tax and multi-currency in Phase 3 | Deferred by ideation: GBP only. Consider a merchant of record when the first non-UK customer appears. |
| `next build --turbopack` for production | Rejected by ideation until proven: beta in 15.5 for native-addon and font-tracing cases. Use plain `next build`, or move to Next 16. |

## Key Decisions & Staging for Next Steps

### Decisions to record before Day 1 (decision log)

1. **Guest write path.** Token plus device-secret `SECURITY DEFINER` RPCs (recommended), and the transport: direct browser-to-RPC or a Next route handler.
2. **Job queue.** A Postgres `jobs` table plus the trigger mechanism (`after()` plus a cron sweeper, or QStash).
3. **Tenant context.** Membership lookup through `private.user_center_ids()`, with many-to-many memberships.
4. **Bank segmentation.** One table with a `visibility` CHECK, or separate tables.
5. **On-demand generation scope.** Deferred to Phase 3 (recommended), or kept in Phase 1 with an "AI-checked" label and a live-session policy.
6. **Verification specification.** Generator and verifier providers, the checklist, the release threshold (1% or 0.5%), and the sample size.
7. **Item type catalogue for Phase 1 GL 11+.** Comprehension MCQ, spelling and punctuation "find the error", cloze subtypes, and synonym MCQ. Each entry gives an example, schema, answer format, scoring rule, PDF and player layouts, and checks.
8. **Cloze normalisation policy**, and whether tutor overrides apply only within a session.
9. **PDF.** Runtime (native Node compiler, subject to the spike), cache key, latency definitions, watermark semantics, paper size (A4).
10. **Session lifecycle.** Single sitting or reusable link, opener and closer, expiry, retakes, the timing rule, resume, what students see at the end, and the grace window.
11. **Student identity model.** Per-session only, or roster codes. Plus alias source and retention period.
12. **Quota unit and counting rules**, and the pilot cap.
13. **Environments and deploy policy.** Staging and prod projects, expand/contract migrations, freeze windows, Next 15.5 vs 16, and the build mode.
14. **Meaning of "region" in Phase 4.** Data residency, locale, currency or exam board.

### Phase 1: first two weeks (proposed build order)

- **Day 0:** decision log (above).
- **Day 1:** foundations.
  - git, `supabase init`, Docker check, staging and prod linked to Vercel (region lhr1).
  - CI running lint, typecheck, vitest, `supabase db reset` and `supabase test db`.
  - Sentry with PII scrubbing; `.env.example`; package renamed.
- **Day 2:** migration 001.
  - `centers` (with region), `memberships`, `profiles`, `invites`.
  - Helper functions, RLS on every table, and `seed.sql` with two tenants.
- **Day 3:** Typst spike (timeboxed). Render a 4-page fixture with bundled fonts in a Vercel Node function. Measure bundle size, cold start and warm render. Record the runtime decision.
- **Day 4:** RLS harness. pgTAP matrix, coverage meta-test, view and definer guards, Storage policies with tests, and a two-tenant Vitest integration.
- **Day 5:** auth.
  - Email with custom SMTP, plus Google if chosen.
  - Center onboarding and tutor invites with expiring tokens.
  - Playwright end-to-end tests.
- **Day 6:** content domain.
  - Reference tables; passages, items and versions; the separate keys table; immutability triggers; worksheets and versions.
  - Cross-tenant reference trigger and shared-bank write negative tests.
  - Zod discriminated union with JSON Schema export; pure scoring module with tests.
- **Day 7:** LLM layer. Provider wrapper with timeout, retry, `llm_calls` metering, kill switch and daily cost breaker. `jobs` table and worker. Pipeline: generate, Zod refine, deterministic gates, blind verify, set status.
- **Day 8:** evaluation harness. Golden and mutation sets as fixtures, an `eval` CLI, and a nightly CI job.
- **Day 9:** bank tooling. Batch CLI, minimal review page that writes `item_reviews`, stratified sampler, and the flag, quarantine and replace flow.
- **Day 10:** branding and PDF.
  - Logo upload with sanitisation, accent colour and header, producing `brand_versions`.
  - Assembly into a `worksheet_version`; render on freeze with the full cache key; student and key variants.
  - Hostile-string corpus and golden-file tests.

Expect spillover into week 3 for PDF polish, the first full bank batch and the remaining alert wiring.

### Exit criteria by phase

- **Phase 1**
  - The RLS matrix and coverage guards are green and required for merge.
  - The verifier rejects at least 99% of mutations and wrongly rejects at most 5% of golden items.
  - At least one released 11+ bank batch per skill has passed the sampling gate.
  - PDF golden tests are green, and latency targets are measured on staging.
  - Every LLM call is metered, and the kill switch and breaker are tested.
  - The entitlements table is live with manual rows.
  - One PITR restore drill is done.
  - The DPIA draft exists.
- **Phase 2**
  - The DPIA, DPA and retention purge job are in place before any child data is processed.
  - The k6 scenarios A-D pass at 1.5x load with zero answers lost by reconciliation.
  - The Playwright offline, abort and resume suite is green.
  - The live API is versioned and freeze windows are documented.
  - Pilots have run at least 20 real sessions with zero lost answers, checked by daily reconciliation.
- **Phase 3**
  - The webhook replay suite is green: duplicate, out-of-order, bad signature, handler failure followed by replay, trial end, and downgrade.
  - The `deriveEntitlement` status table is green.
  - Reconciliation has shown zero drift for 14 days.
  - Pilots have moved to Stripe with no lockout.
  - Quotas are tested at limit-1, at the limit and at limit+1.
  - A per-center cost vs revenue report exists.
- **Phase 4**
  - The second format ships with additive migrations only.
  - It has its own golden and mutation sets and its own sampling gate.
  - UK golden PDFs are unchanged.
  - The region decision is implemented, or deferred with bank export and import proven.

### Open business-level inconsistencies (for the author)

- **ARR target vs tier prices.** $255k ARR from 250 centers is about $85 per center per month, which is above the $79 Standard tier. The target therefore depends on Enterprise features that the hypothesis has dropped. Either re-base the target or schedule those features.
- **Currency.** Tiers are priced in USD for a UK-first launch. Price in GBP.
- **Scaling limit.** For one person, the binding limit at 250 centers is support load (onboarding, flags, billing questions), not infrastructure. The shared bank is what keeps that load manageable.
- **Requirements traceability.** The design doc should carry a table mapping each FR and NFR to a phase, a status (kept, restated, deferred or retired) and a rationale. That covers PAY-02, PDF-03, the multi-region NFR, global FCP, LIVE-03 "real-time", GEN-02 and the BRD P4 items.
