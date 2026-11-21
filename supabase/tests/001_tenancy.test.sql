-- Tenancy and RLS tests for migration 001. Run with: pnpm test:db
-- Relies on supabase/seed.sql (alice/bob at Alpha, carol at Beta, dave without a center).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Structural guards
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables
    where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has RLS enabled'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'private')),
  array['accept_invite', 'create_center', 'create_invite', 'handle_new_user',
        'user_center_ids', 'user_owner_center_ids'],
  'SECURITY DEFINER functions match the reviewed allowlist'
);

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'private')
      and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  0,
  'every SECURITY DEFINER function pins search_path'
);

-- ---------------------------------------------------------------------------
-- anon sees nothing
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok('select count(*) from public.centers', '42501', null, 'anon cannot read centers');
select throws_ok($$select public.create_center('x')$$, '42501', null, 'anon cannot call create_center');
reset role;

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------
-- alice (owner, Alpha)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","email":"alice@alpha.test","role":"authenticated"}';

select results_eq('select name from public.centers order by name', array['Alpha Tuition'], 'alice sees only Alpha');
select is((select count(*)::int from public.memberships), 2, 'alice sees the Alpha roster (2 members)');
select is((select count(*)::int from public.profiles), 2, 'alice sees profiles of Alpha colleagues only');
select is(
  (select count(*)::int from public.memberships where center_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0, 'alice cannot see Beta memberships');

update public.centers set name = 'Alpha Tuition Ltd' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select name from public.centers where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Alpha Tuition Ltd', 'owner can rename own center');

update public.centers set name = 'pwned' where id = 'bbbbbbbb-0000-4000-8000-000000000002';
reset role;
select is((select name from public.centers where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'Beta Learning', 'owner cannot rename another tenant''s center');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","email":"alice@alpha.test","role":"authenticated"}';
select throws_ok(
  $$update public.centers set stripe_customer_id = 'cus_x' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'clients cannot write stripe_customer_id');
select throws_ok(
  $$insert into public.centers (name) values ('direct insert')$$,
  '42501', null, 'centers cannot be inserted directly');
select throws_ok(
  $$insert into public.memberships (user_id, center_id, role) values ('a0000000-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner')$$,
  '42501', null, 'memberships cannot be inserted directly');
select throws_ok('select count(*) from public.platform_admins', '42501', null, 'platform_admins is not readable');
select throws_ok('select token_hash from public.invites', '42501', null, 'invite token_hash is not readable');

-- bob (tutor, Alpha): can read but not administer
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","email":"bob@alpha.test","role":"authenticated"}';
select results_eq('select name from public.centers', array['Alpha Tuition Ltd'], 'bob sees Alpha');
update public.centers set name = 'bob was here' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select name from public.centers where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'Alpha Tuition Ltd', 'tutor cannot rename center');
update public.memberships set role = 'owner' where user_id = 'b0000000-0000-4000-8000-00000000000b';
select is((select role from public.memberships where user_id = 'b0000000-0000-4000-8000-00000000000b'),
  'tutor', 'tutor cannot promote themself');
select throws_ok(
  $$select public.create_invite('aaaaaaaa-0000-4000-8000-000000000001', 'x@example.test')$$,
  '42501', null, 'tutor cannot create invites');

-- carol (owner, Beta)
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-00000000000c","email":"carol@beta.test","role":"authenticated"}';
select results_eq('select name from public.centers', array['Beta Learning'], 'carol sees only Beta');
select throws_ok(
  $$select public.create_invite('aaaaaaaa-0000-4000-8000-000000000001', 'x@example.test')$$,
  '42501', null, 'owner cannot invite into another tenant');

-- ---------------------------------------------------------------------------
-- create_center
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-00000000000d","email":"dave@example.test","role":"authenticated"}';
select is((select count(*)::int from public.centers), 0, 'dave starts with no centers');
select lives_ok($$select public.create_center('Dave''s Den')$$, 'any signed-in user can create a center');
select results_eq('select name from public.centers', array['Dave''s Den'], 'creator sees the new center');
select is((select role from public.memberships where user_id = 'd0000000-0000-4000-8000-00000000000d'),
  'owner', 'creator becomes owner');
select throws_ok($$select public.create_center('   ')$$, '23514', null, 'blank center name is rejected');

-- ---------------------------------------------------------------------------
-- Invite flow
-- ---------------------------------------------------------------------------
reset role;
create temp table t_tokens (label text primary key, token text);
grant all on t_tokens to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-00000000000c","email":"carol@beta.test","role":"authenticated"}';
insert into t_tokens values ('dave', public.create_invite('bbbbbbbb-0000-4000-8000-000000000002', '  Dave@Example.test '));
insert into t_tokens values ('expired', public.create_invite('bbbbbbbb-0000-4000-8000-000000000002', 'late@example.test'));
select is((select email from public.invites where email like 'dave%'), 'dave@example.test', 'invite email is normalised');
select throws_ok(
  $$select public.create_invite('bbbbbbbb-0000-4000-8000-000000000002', 'dave@example.test')$$,
  '23505', null, 'duplicate pending invite is rejected');

-- the wrong user cannot redeem dave's token
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","email":"bob@alpha.test","role":"authenticated"}';
select throws_ok(
  $$select public.accept_invite((select token from t_tokens where label = 'dave'))$$,
  'P0001', 'invite is invalid or expired', 'invite cannot be redeemed with a different email');
select throws_ok($$select public.accept_invite('not-a-token')$$, 'P0001', null, 'unknown token is rejected');

-- dave accepts
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-00000000000d","email":"dave@example.test","role":"authenticated"}';
select is(public.accept_invite((select token from t_tokens where label = 'dave')),
  'bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'invitee accepts and joins');
select is((select count(*)::int from public.centers), 2, 'dave now sees two centers (multi-center tutor)');
select throws_ok(
  $$select public.accept_invite((select token from t_tokens where label = 'dave'))$$,
  'P0001', null, 'invite cannot be reused');

-- expired invite
reset role;
update public.invites set expires_at = now() - interval '1 minute' where email = 'late@example.test';
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated',
        'late@example.test', '', now(), now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-4000-8000-00000000000e","email":"late@example.test","role":"authenticated"}';
select throws_ok(
  $$select public.accept_invite((select token from t_tokens where label = 'expired'))$$,
  'P0001', null, 'expired invite is rejected');
select is((select count(*)::int from public.profiles where user_id = 'e0000000-0000-4000-8000-00000000000e'),
  1, 'a profile row is created for every new auth user');

-- ---------------------------------------------------------------------------
-- Removal takes effect immediately; last owner is protected
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","email":"alice@alpha.test","role":"authenticated"}';
update public.memberships set status = 'removed' where user_id = 'b0000000-0000-4000-8000-00000000000b';

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-00000000000b","email":"bob@alpha.test","role":"authenticated"}';
select is((select count(*)::int from public.centers), 0, 'removed tutor loses access on the next request');
select is((select string_agg(status, ',') from public.memberships), 'removed', 'removed tutor can still see their own membership row');

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","email":"alice@alpha.test","role":"authenticated"}';
select throws_ok(
  $$update public.memberships set role = 'tutor' where user_id = 'a0000000-0000-4000-8000-00000000000a'$$,
  '23514', 'a center must keep at least one active owner', 'last owner cannot demote themself');
select throws_ok(
  $$update public.memberships set user_id = 'c0000000-0000-4000-8000-00000000000c' where user_id = 'a0000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'membership user_id is immutable for clients');

reset role;
select * from finish();
rollback;
