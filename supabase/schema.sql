-- SAPC application data schema.
-- Run this once in Supabase Dashboard > SQL Editor > New query.
-- App requests go through the Render API, which verifies Firebase ID tokens.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id text primary key,
  email text not null default '',
  display_name text not null default 'Paduan',
  display_name_lower text not null default 'paduan',
  username text not null default '',
  username_lower text not null default '',
  bio text not null default '',
  photo_url text not null default '',
  grade_level text not null default '',
  strand text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index if not exists profiles_username_lower_unique
  on public.profiles (username_lower) where username_lower <> '';
create index if not exists profiles_display_name_lower_idx
  on public.profiles (display_name_lower);

create table if not exists public.decks (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  title text not null default 'Saved Reviewer Deck',
  subject_mode text not null default 'general',
  grade_level text not null default 'Grade 11',
  academic_strand text not null default 'General',
  tags jsonb not null default '[]'::jsonb,
  cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decks_owner_updated_idx on public.decks (owner_id, updated_at desc);

create table if not exists public.study_sessions (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  deck_id text not null default 'local-session',
  correct integer not null default 0 check (correct >= 0),
  total integer not null default 0 check (total >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  completed_at timestamptz not null default now()
);
create index if not exists study_sessions_owner_completed_idx on public.study_sessions (owner_id, completed_at desc);

create table if not exists public.shared_decks (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  title text not null default 'Shared Reviewer Deck',
  subject_mode text not null default 'general',
  cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id text primary key,
  from_id text not null references public.profiles(user_id) on delete cascade,
  to_id text not null references public.profiles(user_id) on delete cascade,
  from_name text not null default 'Paduan',
  to_name text not null default 'Paduan',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create index if not exists friend_requests_from_idx on public.friend_requests (from_id, status);
create index if not exists friend_requests_to_idx on public.friend_requests (to_id, status);

create table if not exists public.chat_conversations (
  id text primary key,
  type text not null default 'direct' check (type in ('direct', 'group')),
  title text not null default '',
  created_by text not null references public.profiles(user_id) on delete cascade,
  participants text[] not null,
  members jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_conversations_participants_idx on public.chat_conversations using gin (participants);
create index if not exists chat_conversations_updated_idx on public.chat_conversations (updated_at desc);

create table if not exists public.chat_messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.chat_conversations(id) on delete cascade,
  sender_id text not null references public.profiles(user_id) on delete cascade,
  text text not null default '',
  ciphertext text,
  iv text,
  is_unsent boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  reactions jsonb not null default '{}'::jsonb,
  reply_to jsonb,
  seen_by jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.chat_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
create index if not exists chat_messages_conversation_time_idx on public.chat_messages (conversation_id, timestamp desc);
create index if not exists chat_messages_conversation_updated_idx on public.chat_messages (conversation_id, updated_at desc);

create table if not exists public.chat_attachments (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null references public.profiles(user_id) on delete cascade,
  conversation_id text not null references public.chat_conversations(id) on delete cascade,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null unique,
  is_referenced boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.policy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now()
);
create index if not exists policy_consents_user_time_idx on public.policy_consents (user_id, accepted_at desc);

create table if not exists public.user_blocks (
  blocker_id text not null references public.profiles(user_id) on delete cascade,
  blocked_user_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

create table if not exists public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id text not null references public.profiles(user_id) on delete cascade,
  reported_user_id text not null references public.profiles(user_id) on delete cascade,
  conversation_id text references public.chat_conversations(id) on delete set null,
  message_id text,
  category text not null check (category in ('harassment', 'threat', 'sexual_content', 'spam', 'self_harm', 'other')),
  details text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  check (reporter_id <> reported_user_id)
);
create index if not exists safety_reports_created_idx on public.safety_reports (created_at desc);

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  request_type text not null check (request_type in ('access', 'correction', 'erasure', 'withdraw_consent', 'other')),
  details text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'reviewing', 'completed', 'declined'))
);
create index if not exists privacy_requests_created_idx on public.privacy_requests (created_at desc);

create table if not exists public.ai_prompt_usage (
  user_id text primary key,
  prompt_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Durable AI request line. Requests are owned by one Firebase user and are
-- removed from the payload column after completion to limit retained notes.
create table if not exists public.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  request_payload jsonb,
  cards jsonb,
  error_code text,
  error_message text,
  retry_after_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_until timestamptz
);
create index if not exists ai_generation_jobs_queue_idx
  on public.ai_generation_jobs (status, created_at);
create index if not exists ai_generation_jobs_owner_idx
  on public.ai_generation_jobs (owner_id, created_at desc);

-- Private object bucket for chat uploads; access is proxied through Render.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

create or replace function public.reserve_ai_prompt(p_user_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare next_count integer;
begin
  insert into public.ai_prompt_usage (user_id, prompt_count, updated_at)
  values (p_user_id, 1, now())
  on conflict (user_id) do update
    set prompt_count = public.ai_prompt_usage.prompt_count + 1,
        updated_at = now()
  returning prompt_count into next_count;
  return next_count;
end;
$$;
revoke all on function public.reserve_ai_prompt(text) from public, anon, authenticated;
grant execute on function public.reserve_ai_prompt(text) to service_role;

-- Claims one job globally, even if more than one Render instance is running.
-- A stale running job is returned to the line after its lease expires.
create or replace function public.claim_ai_generation_job()
returns table(job_id uuid, owner_id text, request_payload jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not pg_try_advisory_xact_lock(7834201) then
    return;
  end if;

  delete from public.ai_generation_jobs
  where status in ('completed', 'failed') and completed_at < now() - interval '7 days';

  update public.ai_generation_jobs
  set status = 'queued', updated_at = now(), started_at = null, lease_until = null
  where status = 'running' and lease_until < now();

  if exists (
    select 1 from public.ai_generation_jobs
    where status = 'running' and lease_until >= now()
  ) then
    return;
  end if;

  return query
  with next_job as (
    select j.id from public.ai_generation_jobs j
    where j.status = 'queued'
    order by j.created_at, j.id
    for update skip locked
    limit 1
  )
  update public.ai_generation_jobs j
  set status = 'running', started_at = now(), updated_at = now(), lease_until = now() + interval '15 minutes'
  from next_job
  where j.id = next_job.id
  returning j.id, j.owner_id, j.request_payload;
end;
$$;
revoke all on function public.claim_ai_generation_job() from public, anon, authenticated;
grant execute on function public.claim_ai_generation_job() to service_role;

create or replace function public.mark_chat_messages_seen(
  p_conversation_id text,
  p_user_id text,
  p_message_ids text[]
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_messages
  set seen_by = coalesce(seen_by, '{}'::jsonb) || jsonb_build_object(p_user_id, now()),
      updated_at = now()
  where conversation_id = p_conversation_id
    and id = any(p_message_ids)
    and sender_id <> p_user_id
    and not (coalesce(seen_by, '{}'::jsonb) ? p_user_id);
$$;
revoke all on function public.mark_chat_messages_seen(text, text, text[]) from public, anon, authenticated;
grant execute on function public.mark_chat_messages_seen(text, text, text[]) to service_role;

create or replace function public.toggle_chat_message_reaction(
  p_conversation_id text,
  p_message_id text,
  p_user_id text,
  p_emoji text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.chat_messages;
  next_reactions jsonb;
  reacting_users jsonb;
begin
  if p_emoji not in ('❤️', '😂', '😮', '😢', '😡', '👍') then
    raise exception 'Unsupported reaction';
  end if;
  select * into message_row
  from public.chat_messages
  where id = p_message_id and conversation_id = p_conversation_id
  for update;
  if not found then raise exception 'Message not found'; end if;
  if message_row.is_unsent then raise exception 'Message was unsent'; end if;

  next_reactions := coalesce(message_row.reactions, '{}'::jsonb);
  reacting_users := coalesce(next_reactions -> p_emoji, '[]'::jsonb);
  if reacting_users ? p_user_id then
    select coalesce(jsonb_agg(user_id), '[]'::jsonb) into reacting_users
    from jsonb_array_elements_text(reacting_users) as entries(user_id)
    where user_id <> p_user_id;
  else
    reacting_users := reacting_users || jsonb_build_array(p_user_id);
  end if;
  if jsonb_array_length(reacting_users) = 0 then
    next_reactions := next_reactions - p_emoji;
  else
    next_reactions := jsonb_set(next_reactions, array[p_emoji], reacting_users, true);
  end if;

  update public.chat_messages
  set reactions = next_reactions, updated_at = now()
  where id = p_message_id and conversation_id = p_conversation_id
  returning * into message_row;
  return message_row;
end;
$$;
revoke all on function public.toggle_chat_message_reaction(text, text, text, text) from public, anon, authenticated;
grant execute on function public.toggle_chat_message_reaction(text, text, text, text) to service_role;

-- The browser must not access these tables directly. Render uses the
-- server-only service role after verifying the Firebase user token.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'decks', 'study_sessions', 'shared_decks', 'friend_requests',
    'chat_conversations', 'chat_messages', 'chat_attachments', 'ai_prompt_usage',
    'ai_generation_jobs', 'policy_consents', 'user_blocks', 'safety_reports',
    'privacy_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;
