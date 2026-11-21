-- Apply this migration to an existing Supabase project before deploying the
-- consent, privacy-request, reporting, and blocking routes.
create extension if not exists pgcrypto;

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

do $$
declare table_name text;
begin
  foreach table_name in array array['policy_consents','user_blocks','safety_reports','privacy_requests'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

-- Make the new tables visible to PostgREST immediately.
notify pgrst, 'reload schema';
