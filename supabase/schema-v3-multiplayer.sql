-- ================================================================
-- SOLAR ODYSSEY — MULTIPLAYER + FRIEND SEARCH (schema v3)
-- ================================================================
-- Run AFTER schema.sql and schema-v2.sql. Idempotent.
--
-- Adds:
--   · search_players(query)  — fixed friend search (works signed-in)
--   · send_coop_invite()     — durable invite fallback via presence
--   · presence.pose jsonb    — optional structured pose (kept optional
--                              so older clients that only write `location`
--                              keep working)
--   · grants so authenticated users can SELECT presence by server
-- ================================================================

-- Friend / commander search. SECURITY DEFINER so the ILIKE runs with the
-- definer's rights and is not blocked by a missing SELECT grant edge-case;
-- still restricted to the columns a client is allowed to see.
create or replace function public.search_players(query text, max_rows int default 15)
returns table (id uuid, handle text, region text, last_seen timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(query, ''));
  lim int := least(greatest(coalesce(max_rows, 15), 1), 30);
begin
  if length(q) < 2 then
    return;
  end if;
  -- Strip wildcard metacharacters the user typed so ILIKE stays predictable.
  q := regexp_replace(q, '[%_*\\]', '', 'g');
  if length(q) < 2 then
    return;
  end if;

  return query
    select p.id, p.handle, p.region, p.last_seen
    from public.profiles p
    where p.handle ilike ('%' || q || '%')
    order by
      -- exact prefix first, then alphabetical
      (p.handle ilike (q || '%')) desc,
      p.handle asc
    limit lim;
end;
$$;

revoke execute on function public.search_players(text, int) from public, anon;
grant execute on function public.search_players(text, int) to authenticated;
-- Also allow anon so a connected-but-guest player can still look people up
-- (they just can't friend-request until signed in).
grant execute on function public.search_players(text, int) to anon;


-- Durable co-op invite: stamps a short-lived marker onto the friend's
-- presence.location. The friend's client polls presence and offers JOIN.
create or replace function public.send_coop_invite(
  target_user uuid,
  target_server uuid,
  server_name text default 'Co-op expedition'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_handle text;
  payload text;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if target_user is null or target_server is null then
    raise exception 'Friend and server are required';
  end if;
  if target_user = actor_id then
    raise exception 'You are already on this expedition, Commander';
  end if;
  -- Must be friends (accepted either direction).
  if not exists (
    select 1 from public.friends
    where status = 'accepted'
      and ((user_id = actor_id and friend_id = target_user)
        or (user_id = target_user and friend_id = actor_id))
  ) then
    raise exception 'You can only invite accepted friends';
  end if;
  if not exists (select 1 from public.servers where id = target_server) then
    raise exception 'Server does not exist';
  end if;

  select handle into actor_handle from public.profiles where id = actor_id;
  payload := json_build_object(
    'invite', true,
    'from', actor_id,
    'fromHandle', coalesce(actor_handle, 'Commander'),
    'serverId', target_server,
    'serverName', left(coalesce(server_name, 'Co-op expedition'), 80),
    'at', extract(epoch from now()) * 1000
  )::text;

  insert into public.presence (user_id, server_id, status, location, updated_at)
  values (target_user, null, 'online', payload, now())
  on conflict (user_id) do update
    set location = excluded.location,
        updated_at = now();
  -- NOTE: we deliberately do NOT move the friend onto the server — they
  -- accept the invite on their client, which then calls update_presence.

  return true;
end;
$$;

revoke execute on function public.send_coop_invite(uuid, uuid, text) from public, anon;
grant execute on function public.send_coop_invite(uuid, uuid, text) to authenticated;


-- Make sure authenticated can read presence (needed for roster + invites).
-- schema-v2 already has "presence readable"; re-assert for safety.
drop policy if exists "presence readable" on public.presence;
create policy "presence readable"
on public.presence for select to authenticated using (true);

-- Public profiles readable by authenticated (search_players covers the
-- common path; REST fallback still needs this).
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
on public.profiles for select to authenticated using (true);

-- Anon can read public profile handles for the guest search fallback.
drop policy if exists "profiles readable by anon" on public.profiles;
create policy "profiles readable by anon"
on public.profiles for select to anon using (true);

grant select on public.profiles to anon;
grant select on public.presence to authenticated;
grant select on public.servers  to authenticated, anon;
