-- Migration 001: tenancy foundation.
-- centers, profiles, memberships (many-to-many), invites and platform_admins,
-- plus tenant helper functions and RLS on every table.
--
-- Conventions (docs/decisions.md #3, brief §3):
--   * Tenant context comes from a membership lookup (private.user_center_ids()),
--     never from a JWT claim. That way a removed tutor loses access on their next request.
--   * One policy per command and never FOR ALL. Grants are narrowed per column so
--     clients cannot write columns such as stripe_customer_id or region.
--   * Writes that need to bypass RLS go through SECURITY DEFINER RPCs with
--     search_path = '' and explicit checks.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Generic trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.centers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  -- Stored from day one so a Phase 4 region split needs no re-keying (decision #14).
  region             text not null default 'uk' check (region in ('uk')),
  stripe_customer_id text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.memberships (
  user_id    uuid not null references auth.users (id) on delete cascade,
  center_id  uuid not null references public.centers (id) on delete cascade,
  role       text not null check (role in ('owner', 'tutor')),
  status     text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, center_id)
);
create index memberships_center_id_idx on public.memberships (center_id);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references public.centers (id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role        text not null default 'tutor' check (role in ('owner', 'tutor')),
  token_hash  bytea not null unique,
  invited_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index invites_center_id_idx on public.invites (center_id);
-- At most one pending invite per email per center.
create unique index invites_pending_unique
  on public.invites (center_id, email) where accepted_at is null;

-- Platform staff. Never referenced by tenant RLS policies; used only by
-- privileged server code and SQL.
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create trigger centers_set_updated_at before update on public.centers
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant helpers (SECURITY DEFINER, so they read memberships without RLS
-- recursion). They live in `private`, which PostgREST does not expose.
-- ---------------------------------------------------------------------------
create function private.user_center_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.center_id), '{}')
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active';
$$;

create function private.user_owner_center_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.center_id), '{}')
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = 'owner';
$$;

revoke all on function private.user_center_ids() from public;
revoke all on function private.user_owner_center_ids() from public;
grant execute on function private.user_center_ids() to authenticated;
grant execute on function private.user_owner_center_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Guard: a center must always keep at least one active owner.
-- Locks the center row so two owners demoting each other at once cannot both
-- succeed.
-- ---------------------------------------------------------------------------
create function private.guard_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (new.role <> 'owner' or new.status <> 'active') then
    perform 1 from public.centers c where c.id = old.center_id for update;
    if not exists (
      select 1 from public.memberships m
      where m.center_id = old.center_id
        and m.status = 'active'
        and m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception 'a center must keep at least one active owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard_last_owner before update on public.memberships
  for each row execute function private.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Profile row for every new auth user
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.centers         enable row level security;
alter table public.profiles        enable row level security;
alter table public.memberships     enable row level security;
alter table public.invites         enable row level security;
alter table public.platform_admins enable row level security;

-- Start from no privileges, then grant only what each policy is meant to allow.
revoke all on table public.centers, public.profiles, public.memberships,
  public.invites, public.platform_admins from anon, authenticated;

-- centers: members read their own centers; owners can rename them. Inserts go
-- only through create_center(). No deletes in Phase 1.
grant select on table public.centers to authenticated;
grant update (name) on table public.centers to authenticated;

create policy centers_select on public.centers
  for select to authenticated
  using (id = any ((select private.user_center_ids())::uuid[]));

create policy centers_update on public.centers
  for update to authenticated
  using (id = any ((select private.user_owner_center_ids())::uuid[]))
  with check (id = any ((select private.user_owner_center_ids())::uuid[]));

-- profiles: a user reads their own profile and those of colleagues at shared
-- centers, and edits only their own display name.
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.user_id
        and m.status = 'active'
        and m.center_id = any ((select private.user_center_ids())::uuid[])
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- memberships: members see the roster of their centers, and everyone sees
-- their own rows, including removed ones. Owners change role and status.
-- Inserts go through create_center() and accept_invite(). No hard deletes:
-- set status = 'removed'.
grant select on table public.memberships to authenticated;
grant update (role, status) on table public.memberships to authenticated;

create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or center_id = any ((select private.user_center_ids())::uuid[])
  );

create policy memberships_update on public.memberships
  for update to authenticated
  using (center_id = any ((select private.user_owner_center_ids())::uuid[]))
  with check (center_id = any ((select private.user_owner_center_ids())::uuid[]));

-- invites: owners list and revoke (delete) their center's invites. The token
-- hash is never readable by clients. Creation and acceptance go through RPCs.
grant select (id, center_id, email, role, invited_by, expires_at, accepted_at, accepted_by, created_at)
  on table public.invites to authenticated;
grant delete on table public.invites to authenticated;

create policy invites_select on public.invites
  for select to authenticated
  using (center_id = any ((select private.user_owner_center_ids())::uuid[]));

create policy invites_delete on public.invites
  for delete to authenticated
  using (
    center_id = any ((select private.user_owner_center_ids())::uuid[])
    and accepted_at is null
  );

-- platform_admins: RLS on and no policies, so clients have no access.

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER; reviewed allowlist, see supabase/tests)
-- ---------------------------------------------------------------------------

-- Create a center and make the caller its owner.
create function public.create_center(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_center_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.centers (name) values (btrim(p_name))
  returning id into v_center_id;

  insert into public.memberships (user_id, center_id, role)
  values (v_uid, v_center_id, 'owner');

  return v_center_id;
end;
$$;

-- Owner invites someone by email. Returns the plaintext token once; only its
-- SHA-256 hash is stored.
create function public.create_invite(p_center_id uuid, p_email text, p_role text default 'tutor')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (p_center_id = any (private.user_owner_center_ids())) then
    raise exception 'only center owners can invite' using errcode = '42501';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invites (center_id, email, role, token_hash, invited_by)
  values (
    p_center_id,
    lower(btrim(p_email)),
    p_role,
    extensions.digest(v_token, 'sha256'),
    v_uid
  );

  return v_token;
end;
$$;

-- The invited user, signed in with the invited email address, accepts.
-- Re-activates a previously removed membership.
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_invite public.invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite
  from public.invites i
  where i.token_hash = extensions.digest(p_token, 'sha256')
  for update;

  -- One generic error for every failure, so the response reveals nothing
  -- about which invites exist.
  if not found
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now()
     or v_invite.email is distinct from v_email then
    raise exception 'invite is invalid or expired' using errcode = 'P0001';
  end if;

  insert into public.memberships (user_id, center_id, role, status)
  values (v_uid, v_invite.center_id, v_invite.role, 'active')
  on conflict (user_id, center_id)
    do update set role = excluded.role, status = 'active';

  update public.invites
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invite.id;

  return v_invite.center_id;
end;
$$;

revoke all on function public.create_center(text) from public, anon;
revoke all on function public.create_invite(uuid, text, text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.create_center(text) to authenticated;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
