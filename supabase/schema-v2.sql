-- ================================================================
-- SOLAR ODYSSEY — SUPABASE HARDENING MIGRATION V2
-- ================================================================
-- Run this AFTER supabase/schema.sql, not instead of it.
-- Paste into the Supabase SQL editor and run once. It is idempotent:
-- running it twice is harmless.
--
-- WHAT THIS DOES
--   The browser can no longer write multiplayer state or counters
--   directly. Those go through RPCs that enforce the rules server-side:
--
--     browser ── send_friend_request()    ─► friends
--             ── respond_friend_request() ─► friends
--             ── remove_friend()          ─► friends
--             ── toggle_rocket_like()     ─► rocket_likes ─► rockets.likes
--             ── record_rocket_download() ─► rockets.downloads
--             ── server_heartbeat()       ─► servers.players
--             ── update_presence()        ─► presence
--
--   Direct UPDATE on servers/rockets/presence/friends is revoked, so a
--   modified client cannot hand itself a million downloads, mark its own
--   server "official", or accept friend requests on someone else's behalf.
--
-- WHAT THIS DOES *NOT* DO
--   This is not server-authoritative gameplay. The database can reject
--   absurd values in a cloud save, but it cannot tell whether the player
--   legitimately earned 500,000 credits. See the note at the bottom.
--
-- Use the anon/publishable key in the game. NEVER ship service_role.
-- ================================================================


-- ================================================================
-- 0. EXTENSIONS + PRIVATE SCHEMA
-- ================================================================
create extension if not exists pgcrypto;

-- Helpers live here so they are not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from anon, authenticated;


-- ================================================================
-- 1. MISSING COLUMNS
-- ================================================================
-- v1 has no updated_at on profiles, and no likes/downloads on rockets,
-- so the triggers and counters below would fail without these.
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

alter table public.rockets
  add column if not exists likes     integer not null default 0;

alter table public.rockets
  add column if not exists downloads integer not null default 0;

-- v1 allowed nulls here; the counter constraints need a concrete value.
update public.rockets set likes     = 0 where likes     is null;
update public.rockets set downloads = 0 where downloads is null;


-- ================================================================
-- 2. AUTOMATIC updated_at
-- ================================================================
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists saves_updated_at on public.saves;
create trigger saves_updated_at before update on public.saves
for each row execute function private.set_updated_at();

drop trigger if exists settings_updated_at on public.settings;
create trigger settings_updated_at before update on public.settings
for each row execute function private.set_updated_at();

drop trigger if exists servers_updated_at on public.servers;
create trigger servers_updated_at before update on public.servers
for each row execute function private.set_updated_at();

drop trigger if exists presence_updated_at on public.presence;
create trigger presence_updated_at before update on public.presence
for each row execute function private.set_updated_at();

drop trigger if exists rockets_updated_at on public.rockets;
create trigger rockets_updated_at before update on public.rockets
for each row execute function private.set_updated_at();


-- ================================================================
-- 3. CLEAN UP DATA THAT WOULD BLOCK THE NEW CONSTRAINTS
-- ================================================================
-- Constraints are validated against existing rows, so anything already
-- out of range must be fixed first or the whole migration aborts.
update public.servers set capacity = least(greatest(capacity, 1), 256)
  where capacity is null or capacity < 1 or capacity > 256;
update public.servers set players = 0 where players is null or players < 0;
update public.servers set players = capacity where players > capacity;
update public.servers set mode = 'coop'
  where mode is null or mode not in ('coop', 'freeplay', 'race');

update public.presence set status = 'online'
  where status is null or status not in ('online', 'in-game', 'offline');

update public.friends set status = 'pending'
  where status is null or status not in ('pending', 'accepted', 'blocked');

delete from public.friends where user_id = friend_id;

update public.saves set credits   = 0 where credits   is null or credits   < 0;
update public.saves set level     = 1 where level     is null or level     < 1;
update public.saves set play_time = 0 where play_time is null or play_time < 0;


-- ================================================================
-- 4. CHECK CONSTRAINTS
-- ================================================================
alter table public.friends drop constraint if exists friends_status_check;
alter table public.friends add constraint friends_status_check
  check (status in ('pending', 'accepted', 'blocked'));

alter table public.friends drop constraint if exists friends_no_self_check;
alter table public.friends add constraint friends_no_self_check
  check (user_id <> friend_id);

alter table public.presence drop constraint if exists presence_status_check;
alter table public.presence add constraint presence_status_check
  check (status in ('online', 'in-game', 'offline'));

alter table public.servers drop constraint if exists servers_mode_check;
alter table public.servers add constraint servers_mode_check
  check (mode in ('coop', 'freeplay', 'race'));

alter table public.servers drop constraint if exists servers_capacity_check;
alter table public.servers add constraint servers_capacity_check
  check (capacity between 1 and 256);

alter table public.servers drop constraint if exists servers_players_check;
alter table public.servers add constraint servers_players_check
  check (players >= 0 and players <= capacity);

alter table public.servers drop constraint if exists servers_name_length_check;
alter table public.servers add constraint servers_name_length_check
  check (char_length(name) between 2 and 80);

alter table public.servers drop constraint if exists servers_region_length_check;
alter table public.servers add constraint servers_region_length_check
  check (char_length(region) between 2 and 32);

alter table public.saves drop constraint if exists saves_slot_check;
alter table public.saves add constraint saves_slot_check
  check (slot between 0 and 9);

alter table public.saves drop constraint if exists saves_play_time_check;
alter table public.saves add constraint saves_play_time_check
  check (play_time >= 0 and play_time <= 1000000000);

alter table public.saves drop constraint if exists saves_credits_check;
alter table public.saves add constraint saves_credits_check
  check (credits >= 0);

alter table public.saves drop constraint if exists saves_level_check;
alter table public.saves add constraint saves_level_check
  check (level between 1 and 10000);

alter table public.rockets drop constraint if exists rockets_downloads_check;
alter table public.rockets add constraint rockets_downloads_check
  check (downloads >= 0);

alter table public.rockets drop constraint if exists rockets_likes_check;
alter table public.rockets add constraint rockets_likes_check
  check (likes >= 0);

alter table public.rockets drop constraint if exists rockets_design_object_check;
alter table public.rockets add constraint rockets_design_object_check
  check (jsonb_typeof(design) = 'object');

alter table public.rockets drop constraint if exists rockets_design_size_check;
alter table public.rockets add constraint rockets_design_size_check
  check (octet_length(design::text) <= 524288);


-- ================================================================
-- 5. PROFILE HANDLE RULES
-- ================================================================
-- The game generates guest handles like "CrimsonPilot482", and sign-up
-- handles are free text, so enforce a shape the client already produces.
-- Existing bad handles are repaired first, otherwise the constraint fails.
update public.profiles
set handle = regexp_replace(handle, '[^A-Za-z0-9_]', '', 'g')
where handle !~ '^[A-Za-z0-9_]+$';

update public.profiles
set handle = rpad(coalesce(nullif(handle, ''), 'Pilot'), 3, '0')
where char_length(coalesce(handle, '')) < 3;

update public.profiles
set handle = left(handle, 24)
where char_length(handle) > 24;

-- Repairs above can collide with the existing unique index; de-duplicate.
with dupes as (
  select id,
         row_number() over (partition by lower(handle) order by created_at, id) as rn
  from public.profiles
)
update public.profiles p
set handle = left(p.handle, 18) || '_' || substr(p.id::text, 1, 4)
from dupes d
where p.id = d.id and d.rn > 1;

alter table public.profiles drop constraint if exists profiles_handle_length_check;
alter table public.profiles add constraint profiles_handle_length_check
  check (char_length(handle) between 3 and 24);

alter table public.profiles drop constraint if exists profiles_handle_format_check;
alter table public.profiles add constraint profiles_handle_format_check
  check (handle ~ '^[A-Za-z0-9_]+$');


-- ================================================================
-- 6. CLOUD SAVE VALIDATION
-- ================================================================
-- The save blob is deliberately schema-free so the game can evolve, but
-- it must be an object, bounded in size, and internally sane.
create or replace function private.validate_save()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  json_level     numeric;
  json_credits   numeric;
  json_play_time numeric;
begin
  if jsonb_typeof(new.data) <> 'object' then
    raise exception 'Save data must be a JSON object';
  end if;

  if octet_length(new.data::text) > 1048576 then
    raise exception 'Save data exceeds the 1 MB limit';
  end if;

  if new.data ? 'level' then
    begin
      json_level := (new.data ->> 'level')::numeric;
    exception when others then
      raise exception 'Save level must be numeric';
    end;
    if json_level < 1 or json_level > 10000 then
      raise exception 'Invalid save level';
    end if;
  end if;

  if new.data ? 'credits' then
    begin
      json_credits := (new.data ->> 'credits')::numeric;
    exception when others then
      raise exception 'Save credits must be numeric';
    end;
    if json_credits < 0 then
      raise exception 'Invalid save credits';
    end if;
  end if;

  if new.data ? 'playTime' then
    begin
      json_play_time := (new.data ->> 'playTime')::numeric;
    exception when others then
      raise exception 'Save playTime must be numeric';
    end;
    if json_play_time < 0 or json_play_time > 1000000000 then
      raise exception 'Invalid save playTime';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_save_trigger on public.saves;
create trigger validate_save_trigger
before insert or update of data on public.saves
for each row execute function private.validate_save();


-- ================================================================
-- 7. FRIEND RPCs
-- ================================================================
-- NOTE: these are SECURITY DEFINER on purpose. Once the direct-write
-- policies are dropped (section 12) a security-invoker function would be
-- blocked by RLS just like a raw insert, so the RPCs would never work.
-- Each one re-checks auth.uid() itself, which is the real authorization.
create or replace function public.send_friend_request(target_user uuid)
returns public.friends
language plpgsql
security definer
set search_path = ''
as $$
declare
  result   public.friends;
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if target_user is null then
    raise exception 'Target user is required';
  end if;
  if target_user = actor_id then
    raise exception 'You cannot befriend yourself, Commander';
  end if;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'User does not exist';
  end if;
  if exists (
    select 1 from public.friends
    where (user_id = actor_id and friend_id = target_user)
       or (user_id = target_user and friend_id = actor_id)
  ) then
    raise exception 'Friend relationship already exists';
  end if;

  insert into public.friends (user_id, friend_id, status)
  values (actor_id, target_user, 'pending')
  returning * into result;

  return result;
end;
$$;


create or replace function public.respond_friend_request(
  request_id uuid,
  new_status text
)
returns public.friends
language plpgsql
security definer
set search_path = ''
as $$
declare
  result   public.friends;
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if new_status not in ('accepted', 'blocked') then
    raise exception 'Invalid friend response';
  end if;

  -- Only the RECIPIENT of a pending request may answer it.
  update public.friends
  set status = new_status
  where id = request_id
    and friend_id = actor_id
    and status = 'pending'
  returning * into result;

  if result.id is null then
    raise exception 'Friend request not found or not authorised';
  end if;

  return result;
end;
$$;


create or replace function public.remove_friend(target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  delete from public.friends
  where (user_id = actor_id and friend_id = target_user)
     or (user_id = target_user and friend_id = actor_id);

  return true;
end;
$$;


-- ================================================================
-- 8. ROCKET LIKES
-- ================================================================
create table if not exists public.rocket_likes (
  rocket_id  uuid not null references public.rockets(id)  on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rocket_id, user_id)
);

alter table public.rocket_likes enable row level security;

drop policy if exists "users see rocket likes" on public.rocket_likes;
create policy "users see rocket likes"
on public.rocket_likes for select to authenticated using (true);

drop policy if exists "users create own rocket likes" on public.rocket_likes;
create policy "users create own rocket likes"
on public.rocket_likes for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users delete own rocket likes" on public.rocket_likes;
create policy "users delete own rocket likes"
on public.rocket_likes for delete to authenticated
using ((select auth.uid()) = user_id);


-- Keep rockets.likes in step with the like table.
-- SECURITY DEFINER because rockets has no client UPDATE policy any more.
create or replace function private.sync_rocket_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.rocket_id, old.rocket_id);
begin
  update public.rockets
  set likes = (select count(*) from public.rocket_likes where rocket_id = target)
  where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists rocket_like_count_trigger on public.rocket_likes;
create trigger rocket_like_count_trigger
after insert or delete on public.rocket_likes
for each row execute function private.sync_rocket_like_count();


create or replace function public.toggle_rocket_like(target_rocket uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id     uuid := (select auth.uid());
  already_liked boolean;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  -- "public" is a reserved-ish word here; qualify it against the table.
  if not exists (
    select 1 from public.rockets r
    where r.id = target_rocket and r.public = true
  ) then
    raise exception 'Rocket not found';
  end if;

  select exists (
    select 1 from public.rocket_likes
    where rocket_id = target_rocket and user_id = actor_id
  ) into already_liked;

  if already_liked then
    delete from public.rocket_likes
    where rocket_id = target_rocket and user_id = actor_id;
    return false;
  else
    insert into public.rocket_likes (rocket_id, user_id)
    values (target_rocket, actor_id);
    return true;
  end if;
end;
$$;


-- ================================================================
-- 9. ROCKET DOWNLOAD COUNTER
-- ================================================================
create or replace function public.record_rocket_download(target_rocket uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  update public.rockets r
  set downloads = r.downloads + 1
  where r.id = target_rocket and r.public = true
  returning r.downloads into new_count;

  if new_count is null then
    raise exception 'Public rocket not found';
  end if;

  return new_count;
end;
$$;


-- ================================================================
-- 10. SERVER HEARTBEAT + CLEANUP
-- ================================================================
-- The owner may report a player count; they may NOT flip `official`
-- or reassign `owner_id`, because this is the only write path left.
create or replace function public.server_heartbeat(
  target_server    uuid,
  reported_players integer default null
)
returns public.servers
language plpgsql
security definer
set search_path = ''
as $$
declare
  result   public.servers;
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if reported_players is not null and reported_players < 0 then
    raise exception 'Invalid player count';
  end if;

  update public.servers s
  set players = case
        when reported_players is null then s.players
        else least(reported_players, s.capacity)
      end,
      updated_at = now()
  where s.id = target_server and s.owner_id = actor_id
  returning * into result;

  if result.id is null then
    raise exception 'Server not found or not owned by caller';
  end if;

  return result;
end;
$$;


-- Trusted scheduler only — never granted to anon/authenticated.
create or replace function private.expire_stale_servers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.servers
  set players = 0
  where official = false
    and updated_at < now() - interval '2 minutes'
    and players <> 0;

  get diagnostics affected = row_count;
  return affected;
end;
$$;


-- ================================================================
-- 11. PRESENCE HEARTBEAT
-- ================================================================
-- SECURITY DEFINER: presence has no direct client write policy any more.
create or replace function public.update_presence(
  target_server uuid default null,
  new_status    text default 'online',
  new_location  text default null
)
returns public.presence
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  result   public.presence;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if new_status not in ('online', 'in-game', 'offline') then
    raise exception 'Invalid presence status';
  end if;
  if target_server is not null
     and not exists (select 1 from public.servers where id = target_server) then
    raise exception 'Server does not exist';
  end if;

  insert into public.presence (user_id, server_id, status, location, updated_at)
  values (actor_id, target_server, new_status, left(new_location, 120), now())
  on conflict (user_id) do update set
    server_id  = excluded.server_id,
    status     = excluded.status,
    location   = excluded.location,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;


-- ================================================================
-- 12. ROW LEVEL SECURITY
-- ================================================================

-- ---- profiles ----
drop policy if exists "profiles are public"          on public.profiles;
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
on public.profiles for select to authenticated using (true);

drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- ---- saves ----
drop policy if exists "own saves"        on public.saves;
drop policy if exists "own saves select" on public.saves;
drop policy if exists "own saves insert" on public.saves;
drop policy if exists "own saves update" on public.saves;
drop policy if exists "own saves delete" on public.saves;

create policy "own saves select" on public.saves for select to authenticated
using ((select auth.uid()) = user_id);
create policy "own saves insert" on public.saves for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "own saves update" on public.saves for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "own saves delete" on public.saves for delete to authenticated
using ((select auth.uid()) = user_id);

-- ---- settings ----
drop policy if exists "own settings"        on public.settings;
drop policy if exists "own settings select" on public.settings;
drop policy if exists "own settings insert" on public.settings;
drop policy if exists "own settings update" on public.settings;
drop policy if exists "own settings delete" on public.settings;

create policy "own settings select" on public.settings for select to authenticated
using ((select auth.uid()) = user_id);
create policy "own settings insert" on public.settings for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "own settings update" on public.settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "own settings delete" on public.settings for delete to authenticated
using ((select auth.uid()) = user_id);

-- ---- friends: read only; all writes go through the RPCs ----
drop policy if exists "see own friend rows"  on public.friends;
drop policy if exists "request friends"      on public.friends;
drop policy if exists "respond to friends"   on public.friends;
drop policy if exists "remove friends"       on public.friends;

create policy "see own friend rows"
on public.friends for select to authenticated
using ((select auth.uid()) = user_id or (select auth.uid()) = friend_id);

-- ---- servers: insert/delete your own, but updates only via heartbeat ----
drop policy if exists "servers are public"     on public.servers;
drop policy if exists "servers readable by authenticated users" on public.servers;
create policy "servers readable by authenticated users"
on public.servers for select to authenticated using (true);

drop policy if exists "host own server" on public.servers;
create policy "host own server"
on public.servers for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and official = false
  and players >= 0
  and players <= capacity
);

-- Deliberately NO update policy — use server_heartbeat().
drop policy if exists "update own server" on public.servers;

drop policy if exists "delete own server" on public.servers;
create policy "delete own server"
on public.servers for delete to authenticated
using ((select auth.uid()) = owner_id and official = false);

-- ---- presence: read only; writes via update_presence() ----
drop policy if exists "presence is public"  on public.presence;
drop policy if exists "presence readable"   on public.presence;
drop policy if exists "own presence"        on public.presence;

create policy "presence readable"
on public.presence for select to authenticated using (true);

-- ---- rockets: no direct UPDATE, so counters cannot be forged ----
drop policy if exists "public or own rockets"    on public.rockets;
drop policy if exists "public rockets readable"  on public.rockets;
create policy "public rockets readable"
on public.rockets for select to authenticated
using (public = true or (select auth.uid()) = owner_id);

drop policy if exists "insert own rockets" on public.rockets;
create policy "insert own rockets"
on public.rockets for insert to authenticated
with check ((select auth.uid()) = owner_id);

-- Deliberately NO general update policy. But the game must still be able
-- to rename/re-share an existing design, so allow an owner update that
-- cannot touch the counters (see the guard trigger below).
drop policy if exists "update own rockets" on public.rockets;
create policy "update own rockets"
on public.rockets for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "delete own rockets" on public.rockets;
create policy "delete own rockets"
on public.rockets for delete to authenticated
using ((select auth.uid()) = owner_id);


-- Freeze likes/downloads/owner against direct client UPDATEs. The RPCs and
-- the like trigger are SECURITY DEFINER, so they bypass this via a flag.
create or replace function private.guard_rocket_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only police statements that arrive from a logged-in API client.
  if (select auth.uid()) is null then
    return new;
  end if;
  if current_setting('solar.counter_write', true) = 'on' then
    return new;
  end if;

  new.likes     := old.likes;
  new.downloads := old.downloads;
  new.owner_id  := old.owner_id;
  return new;
end;
$$;

drop trigger if exists rockets_guard_counters on public.rockets;
create trigger rockets_guard_counters
before update on public.rockets
for each row execute function private.guard_rocket_counters();


-- Let the privileged paths through the guard.
create or replace function private.sync_rocket_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.rocket_id, old.rocket_id);
begin
  perform set_config('solar.counter_write', 'on', true);
  update public.rockets
  set likes = (select count(*) from public.rocket_likes where rocket_id = target)
  where id = target;
  perform set_config('solar.counter_write', 'off', true);
  return coalesce(new, old);
end;
$$;

create or replace function public.record_rocket_download(target_rocket uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  perform set_config('solar.counter_write', 'on', true);
  update public.rockets r
  set downloads = r.downloads + 1
  where r.id = target_rocket and r.public = true
  returning r.downloads into new_count;
  perform set_config('solar.counter_write', 'off', true);

  if new_count is null then
    raise exception 'Public rocket not found';
  end if;

  return new_count;
end;
$$;


-- ================================================================
-- 13. INDEXES
-- ================================================================
create index if not exists rockets_public_updated_idx
  on public.rockets (updated_at desc) where public = true;
create index if not exists rockets_owner_idx        on public.rockets (owner_id);
create index if not exists rocket_likes_user_idx    on public.rocket_likes (user_id);
create index if not exists rocket_likes_rocket_idx  on public.rocket_likes (rocket_id);
create index if not exists saves_user_updated_idx   on public.saves (user_id, updated_at desc);
create index if not exists friends_user_status_idx  on public.friends (user_id, status);
create index if not exists friends_friend_status_idx on public.friends (friend_id, status);
create index if not exists friends_pending_idx
  on public.friends (friend_id) where status = 'pending';
create index if not exists presence_server_idx      on public.presence (server_id, updated_at desc);
create index if not exists presence_status_idx      on public.presence (status, updated_at desc);
create index if not exists servers_region_mode_idx  on public.servers (region, mode, updated_at desc);
create index if not exists servers_active_idx
  on public.servers (region, mode, updated_at desc) where players > 0;


-- ================================================================
-- 14. OFFICIAL SERVER SEED
-- ================================================================
create unique index if not exists servers_official_name_idx
  on public.servers (lower(name)) where official = true;

-- ON CONFLICT cannot target a partial index, so seed with WHERE NOT EXISTS.
insert into public.servers (name, region, mode, capacity, official)
select v.name, v.region, v.mode, v.capacity, true
from (values
  ('Sol Gateway — Mumbai',    'ap-south',       'coop',     32),
  ('Sol Gateway — Singapore', 'ap-south-east',  'coop',     32),
  ('Sol Gateway — Tokyo',     'ap-north-east',  'coop',     32),
  ('Sol Gateway — Frankfurt', 'eu-central',     'coop',     32),
  ('Sol Gateway — London',    'eu-west',        'freeplay', 32),
  ('Sol Gateway — Virginia',  'us-east',        'coop',     32),
  ('Sol Gateway — Oregon',    'us-west',        'freeplay', 32),
  ('Sol Gateway — Sao Paulo', 'sa-east',        'coop',     32),
  ('Sol Gateway — Sydney',    'ap-southeast-2', 'coop',     32)
) as v(name, region, mode, capacity)
where not exists (
  select 1 from public.servers s
  where s.official = true and lower(s.name) = lower(v.name)
);


-- ================================================================
-- 15. FUNCTION EXECUTE PRIVILEGES
-- ================================================================
revoke execute on function public.send_friend_request(uuid)          from public, anon;
revoke execute on function public.respond_friend_request(uuid, text) from public, anon;
revoke execute on function public.remove_friend(uuid)                from public, anon;
revoke execute on function public.toggle_rocket_like(uuid)           from public, anon;
revoke execute on function public.record_rocket_download(uuid)       from public, anon;
revoke execute on function public.server_heartbeat(uuid, integer)    from public, anon;
revoke execute on function public.update_presence(uuid, text, text)  from public, anon;

grant execute on function public.send_friend_request(uuid)          to authenticated;
grant execute on function public.respond_friend_request(uuid, text) to authenticated;
grant execute on function public.remove_friend(uuid)                to authenticated;
grant execute on function public.toggle_rocket_like(uuid)           to authenticated;
grant execute on function public.record_rocket_download(uuid)       to authenticated;
grant execute on function public.server_heartbeat(uuid, integer)    to authenticated;
grant execute on function public.update_presence(uuid, text, text)  to authenticated;

-- Cleanup is backend/admin only.
revoke execute on function private.expire_stale_servers() from public, anon, authenticated;


-- ================================================================
-- 16. TABLE GRANTS
-- ================================================================
-- RLS decides WHICH rows; grants decide whether the role sees the table.
revoke all on public.profiles     from anon;
revoke all on public.saves        from anon;
revoke all on public.settings     from anon;
revoke all on public.friends      from anon;
revoke all on public.servers      from anon;
revoke all on public.presence     from anon;
revoke all on public.rockets      from anon;
revoke all on public.rocket_likes from anon;

grant select, insert, update         on public.profiles     to authenticated;
grant select, insert, update, delete on public.saves        to authenticated;
grant select, insert, update, delete on public.settings     to authenticated;
grant select                         on public.friends      to authenticated;
grant select, insert, delete         on public.rocket_likes to authenticated;
grant select, insert, delete         on public.servers      to authenticated;
grant select                         on public.presence     to authenticated;
grant select, insert, update, delete on public.rockets      to authenticated;


-- ================================================================
-- 17. ENABLE + FORCE RLS
-- ================================================================
alter table public.profiles     enable row level security;
alter table public.saves        enable row level security;
alter table public.settings     enable row level security;
alter table public.friends      enable row level security;
alter table public.servers      enable row level security;
alter table public.presence     enable row level security;
alter table public.rockets      enable row level security;
alter table public.rocket_likes enable row level security;

-- NOTE: FORCE is intentionally NOT applied. FORCE makes RLS apply to the
-- table OWNER too, which is the role the SECURITY DEFINER functions above
-- run as — that would break every RPC in this file. ENABLE already covers
-- anon and authenticated, which is what the browser uses.


-- ================================================================
-- WHAT THIS STILL DOES NOT SOLVE
-- ================================================================
-- The database can reject an impossible save, but it cannot tell whether
-- the player EARNED their credits. A modified client can still submit a
-- plausible-but-unearned GameState.
--
-- A future V3 would split GameState (client-owned) from PlayerProgress
-- (server-owned) and move earning behind RPCs:
--   claim_mission_reward()  buy_ship()      sell_cargo()
--   unlock_planet()         complete_race()
-- That is the layer that actually stops infinite money.
-- ================================================================
