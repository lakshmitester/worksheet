-- Local development seed (runs on `supabase db reset`; never pushed to remote).
-- Two tenants, so cross-tenant behaviour can be checked by hand:
--   Center A "Alpha Tuition": alice (owner), bob (tutor)
--   Center B "Beta Learning": carol (owner)
--   dave: signed up, belongs to no center (use him to test invites)
-- Every user's password is: password123

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.name),
  now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-00000000000a'::uuid, 'alice@alpha.test', 'Alice'),
  ('b0000000-0000-4000-8000-00000000000b'::uuid, 'bob@alpha.test',   'Bob'),
  ('c0000000-0000-4000-8000-00000000000c'::uuid, 'carol@beta.test',  'Carol'),
  ('d0000000-0000-4000-8000-00000000000d'::uuid, 'dave@example.test','Dave')
) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%.test';

insert into public.centers (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Alpha Tuition'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Beta Learning');

insert into public.memberships (user_id, center_id, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'tutor'),
  ('c0000000-0000-4000-8000-00000000000c', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner');
