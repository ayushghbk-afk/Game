-- =====================================================================
-- SOLAR ODYSSEY — Supabase schema
-- Run this once in the Supabase SQL editor of your project.
-- Then paste the Project URL + anon public key into the game:
--   Main menu → ACCOUNT → CONNECT SERVER
-- =====================================================================

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text unique not null,
  region      text default 'auto',
  avatar      text,
  last_seen   timestamptz default now(),
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles
  for select using (true);

drop policy if exists "own profile write" on public.profiles;
create policy "own profile write" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);

-- ---------------------------------------------------------------- saves
-- One row per save slot. `data` is the full GameState JSON.
create table if not exists public.saves (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  slot        int  not null default 0,
  name        text not null default 'Career',
  data        jsonb not null,
  play_time   double precision default 0,
  credits     bigint default 0,
  level       int default 1,
  updated_at  timestamptz default now(),
  unique (user_id, slot)
);

alter table public.saves enable row level security;

drop policy if exists "own saves" on public.saves;
create policy "own saves" on public.saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  user_id     uuid primary key references auth.users on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);

alter table public.settings enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- friends
create table if not exists public.friends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  friend_id   uuid not null references auth.users on delete cascade,
  status      text not null default 'pending', -- pending | accepted | blocked
  created_at  timestamptz default now(),
  unique (user_id, friend_id)
);

alter table public.friends enable row level security;

drop policy if exists "see own friend rows" on public.friends;
create policy "see own friend rows" on public.friends
  for select using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "request friends" on public.friends;
create policy "request friends" on public.friends
  for insert with check (auth.uid() = user_id);

drop policy if exists "respond to friends" on public.friends;
create policy "respond to friends" on public.friends
  for update using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "remove friends" on public.friends;
create policy "remove friends" on public.friends
  for delete using (auth.uid() = user_id or auth.uid() = friend_id);

-- ---------------------------------------------------------------- servers
-- Regional game servers / lobbies players can join.
create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  region      text not null,           -- eu-west, us-east, ap-south, ...
  host        text,                    -- optional realtime channel / url
  mode        text default 'coop',     -- coop | freeplay | race
  players     int  default 0,
  capacity    int  default 16,
  official    boolean default false,
  owner_id    uuid references auth.users on delete cascade,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);

alter table public.servers enable row level security;

drop policy if exists "servers are public" on public.servers;
create policy "servers are public" on public.servers for select using (true);

drop policy if exists "host own server" on public.servers;
create policy "host own server" on public.servers
  for insert with check (auth.uid() = owner_id);

drop policy if exists "update own server" on public.servers;
create policy "update own server" on public.servers
  for update using (auth.uid() = owner_id);

drop policy if exists "delete own server" on public.servers;
create policy "delete own server" on public.servers
  for delete using (auth.uid() = owner_id);

-- Seed the official regional servers (idempotent).
insert into public.servers (name, region, mode, capacity, official)
select * from (values
  ('Sol Gateway — Mumbai',    'ap-south',   'coop',     32, true),
  ('Sol Gateway — Singapore', 'ap-south-east','coop',   32, true),
  ('Sol Gateway — Tokyo',     'ap-north-east','coop',   32, true),
  ('Sol Gateway — Frankfurt', 'eu-central', 'coop',     32, true),
  ('Sol Gateway — London',    'eu-west',    'freeplay', 32, true),
  ('Sol Gateway — Virginia',  'us-east',    'coop',     32, true),
  ('Sol Gateway — Oregon',    'us-west',    'freeplay', 32, true),
  ('Sol Gateway — Sao Paulo', 'sa-east',    'coop',     32, true),
  ('Sol Gateway — Sydney',    'ap-southeast-2','coop',  32, true)
) as v(name, region, mode, capacity, official)
where not exists (select 1 from public.servers where official);

-- ---------------------------------------------------------------- presence
create table if not exists public.presence (
  user_id     uuid primary key references auth.users on delete cascade,
  server_id   uuid references public.servers on delete set null,
  status      text default 'online',   -- online | in-game | offline
  location    text,                    -- 'MARS SURFACE', 'EARTH ORBIT', ...
  updated_at  timestamptz default now()
);

alter table public.presence enable row level security;

drop policy if exists "presence is public" on public.presence;
create policy "presence is public" on public.presence for select using (true);

drop policy if exists "own presence" on public.presence;
create policy "own presence" on public.presence
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- rockets
-- Player-designed rockets. Public ones show in the SHARED tab and can be
-- imported by anyone.
create table if not exists public.rockets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users on delete cascade,
  owner_name  text,
  name        text not null,
  design      jsonb not null,   -- { parts: [...], version: 1 }
  stats       jsonb default '{}'::jsonb,
  public      boolean default false,
  downloads   int default 0,
  likes       int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.rockets enable row level security;

drop policy if exists "public or own rockets" on public.rockets;
create policy "public or own rockets" on public.rockets
  for select using (public = true or auth.uid() = owner_id);

drop policy if exists "insert own rockets" on public.rockets;
create policy "insert own rockets" on public.rockets
  for insert with check (auth.uid() = owner_id);

drop policy if exists "update own rockets" on public.rockets;
create policy "update own rockets" on public.rockets
  for update using (auth.uid() = owner_id);

drop policy if exists "delete own rockets" on public.rockets;
create policy "delete own rockets" on public.rockets
  for delete using (auth.uid() = owner_id);

create index if not exists rockets_public_idx on public.rockets (public, updated_at desc);
create index if not exists servers_region_idx on public.servers (region);
