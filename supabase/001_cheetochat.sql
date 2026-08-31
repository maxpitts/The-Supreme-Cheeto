-- =====================================================================
-- CheetoChat schema
--
-- Everything is namespaced cheeto_* so this can live beside other schemas
-- without collision. Moderation is enforced in the DATABASE, not the client —
-- a hostile user talks straight to the REST API and never runs your JS, so any
-- rule that only exists in the front end is decoration.
-- =====================================================================

-- ---------- profiles ----------
create table if not exists public.cheeto_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text not null unique
               check (handle ~ '^[a-zA-Z0-9_]{3,20}$'),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  is_admin     boolean not null default false,
  is_banned    boolean not null default false,
  ban_reason   text,
  banned_until timestamptz,
  muted_until  timestamptz
);

-- ---------- messages ----------
create table if not exists public.cheeto_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.cheeto_profiles(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.cheeto_profiles(id)
);
create index if not exists cheeto_messages_created_idx
  on public.cheeto_messages (created_at desc) where deleted_at is null;
create index if not exists cheeto_messages_user_idx
  on public.cheeto_messages (user_id, created_at desc);

-- ---------- reports ----------
create table if not exists public.cheeto_reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.cheeto_messages(id) on delete cascade,
  reporter_id uuid   not null references public.cheeto_profiles(id) on delete cascade,
  reason      text   not null check (length(reason) <= 300),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.cheeto_profiles(id),
  unique (message_id, reporter_id)          -- one report per person per message
);

-- ---------- word filter ----------
create table if not exists public.cheeto_blocked_words (
  word       text primary key,
  added_at   timestamptz not null default now()
);

-- =====================================================================
-- HELPERS
-- =====================================================================

create or replace function public.cheeto_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.cheeto_profiles where id = auth.uid()), false);
$$;

-- Account must exist, not be banned, not be muted, have a confirmed email,
-- and be at least 10 minutes old. The age gate is the cheapest possible
-- speed bump against throwaway accounts made mid-argument.
create or replace function public.cheeto_can_post()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p record; confirmed timestamptz;
begin
  select * into p from public.cheeto_profiles where id = auth.uid();
  if p is null then return false; end if;
  if p.is_banned and (p.banned_until is null or p.banned_until > now()) then return false; end if;
  if p.muted_until is not null and p.muted_until > now() then return false; end if;
  if p.created_at > now() - interval '10 minutes' then return false; end if;

  select email_confirmed_at into confirmed from auth.users where id = auth.uid();
  if confirmed is null then return false; end if;

  -- rate limit: 5 messages per 30s, 40 per 10 min
  if (select count(*) from public.cheeto_messages
      where user_id = auth.uid() and created_at > now() - interval '30 seconds') >= 5
  then return false; end if;
  if (select count(*) from public.cheeto_messages
      where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 40
  then return false; end if;

  return true;
end $$;

-- Word filter runs as a trigger so it applies to every write path.
create or replace function public.cheeto_filter_words()
returns trigger language plpgsql security definer set search_path = public as $$
declare hit text;
begin
  select word into hit
  from public.cheeto_blocked_words
  where new.body ~* ('(^|[^a-z])' || word || '([^a-z]|$)')
  limit 1;

  if hit is not null then
    raise exception 'blocked_word' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists cheeto_filter_words_trg on public.cheeto_messages;
create trigger cheeto_filter_words_trg
  before insert on public.cheeto_messages
  for each row execute function public.cheeto_filter_words();

-- New auth user -> profile row, with a handle derived from their identity.
create or replace function public.cheeto_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base text; final text; n int := 0;
begin
  base := regexp_replace(
            coalesce(new.raw_user_meta_data->>'user_name',
                     new.raw_user_meta_data->>'full_name',
                     split_part(new.email, '@', 1),
                     'cheeto'),
            '[^a-zA-Z0-9_]', '', 'g');
  base := left(nullif(base, ''), 16);
  if base is null or length(base) < 3 then base := 'cheeto'; end if;

  final := base;
  while exists (select 1 from public.cheeto_profiles where handle = final) loop
    n := n + 1;
    final := left(base, 15) || n::text;
  end loop;

  insert into public.cheeto_profiles (id, handle, avatar_url)
  values (new.id, final, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists cheeto_on_auth_user_created on auth.users;
create trigger cheeto_on_auth_user_created
  after insert on auth.users
  for each row execute function public.cheeto_handle_new_user();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.cheeto_profiles      enable row level security;
alter table public.cheeto_messages      enable row level security;
alter table public.cheeto_reports       enable row level security;
alter table public.cheeto_blocked_words enable row level security;

-- profiles: public read (handles are shown next to messages), self-update only
drop policy if exists cheeto_profiles_read on public.cheeto_profiles;
create policy cheeto_profiles_read on public.cheeto_profiles
  for select using (true);

drop policy if exists cheeto_profiles_self_update on public.cheeto_profiles;
create policy cheeto_profiles_self_update on public.cheeto_profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    -- a user must never be able to grant themselves admin or lift their own ban
    and is_admin  = (select is_admin  from public.cheeto_profiles where id = auth.uid())
    and is_banned = (select is_banned from public.cheeto_profiles where id = auth.uid())
  );

drop policy if exists cheeto_profiles_admin_all on public.cheeto_profiles;
create policy cheeto_profiles_admin_all on public.cheeto_profiles
  for all using (public.cheeto_is_admin()) with check (public.cheeto_is_admin());

-- messages: everyone reads what isn't deleted; posting runs the full gate
drop policy if exists cheeto_messages_read on public.cheeto_messages;
create policy cheeto_messages_read on public.cheeto_messages
  for select using (deleted_at is null or public.cheeto_is_admin());

drop policy if exists cheeto_messages_insert on public.cheeto_messages;
create policy cheeto_messages_insert on public.cheeto_messages
  for insert with check (user_id = auth.uid() and public.cheeto_can_post());

-- authors may soft-delete their own; admins may soft-delete anything
drop policy if exists cheeto_messages_update on public.cheeto_messages;
create policy cheeto_messages_update on public.cheeto_messages
  for update using (user_id = auth.uid() or public.cheeto_is_admin())
  with check  (user_id = auth.uid() or public.cheeto_is_admin());

-- nothing is ever hard-deleted by a user; moderation must leave a trail
drop policy if exists cheeto_messages_admin_delete on public.cheeto_messages;
create policy cheeto_messages_admin_delete on public.cheeto_messages
  for delete using (public.cheeto_is_admin());

-- reports: you file your own and see your own; admins see everything
drop policy if exists cheeto_reports_insert on public.cheeto_reports;
create policy cheeto_reports_insert on public.cheeto_reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists cheeto_reports_read on public.cheeto_reports;
create policy cheeto_reports_read on public.cheeto_reports
  for select using (reporter_id = auth.uid() or public.cheeto_is_admin());

drop policy if exists cheeto_reports_admin_update on public.cheeto_reports;
create policy cheeto_reports_admin_update on public.cheeto_reports
  for update using (public.cheeto_is_admin()) with check (public.cheeto_is_admin());

-- blocked words: admin-only in both directions. The list is not public —
-- publishing it just tells people exactly what to work around.
drop policy if exists cheeto_words_admin on public.cheeto_blocked_words;
create policy cheeto_words_admin on public.cheeto_blocked_words
  for all using (public.cheeto_is_admin()) with check (public.cheeto_is_admin());

-- =====================================================================
-- REALTIME
-- =====================================================================
alter publication supabase_realtime add table public.cheeto_messages;

-- =====================================================================
-- AFTER APPLYING:
--   1. Auth > Providers: enable Google and Discord, paste client id/secret.
--   2. Auth > URL Configuration: Site URL = https://supremecheeto.club
--      Redirect URLs: https://supremecheeto.club/**, https://main--supremecheeto.netlify.app/**
--   3. Make yourself an admin (run once, with your own user id):
--        update public.cheeto_profiles set is_admin = true where handle = 'YOURHANDLE';
--   4. Seed the word filter with whatever you actually want blocked.
-- =====================================================================
