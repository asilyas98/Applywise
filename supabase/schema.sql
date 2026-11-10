-- Offer Desk schema. Run once in a NEW Supabase project: SQL Editor → paste → Run.
-- Every row belongs to one user and Row Level Security keeps it private to them.

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  target      text not null default '',
  resume      text not null default '',
  experience  text not null default '',
  ai_consent  boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table if not exists public.jobs (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists jobs_user_idx on public.jobs(user_id);

create table if not exists public.letters (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists letters_user_idx on public.letters(user_id);

-- Daily AI call counter, written only by the Netlify function (service role).
create table if not exists public.ai_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null default (now() at time zone 'utc')::date,
  calls    integer not null default 0,
  primary key (user_id, day)
);

alter table public.profiles enable row level security;
alter table public.jobs     enable row level security;
alter table public.letters  enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own letters" on public.letters;
create policy "own letters" on public.letters for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (auth.uid() = user_id);

-- Atomic increment used by the AI function. Returns today's count after incrementing.
create or replace function public.bump_ai_usage(p_user uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (user_id, day, calls)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls;
$$;
revoke all on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;
