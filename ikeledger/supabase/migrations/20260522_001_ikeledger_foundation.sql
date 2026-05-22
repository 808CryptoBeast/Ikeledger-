-- IkeLedger foundation schema
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  handle text unique,
  home_realm text,
  public_wallet_address text,
  mana_balance integer not null default 0,
  preferred_learning_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  network text not null default 'xrpl-mainnet',
  provider text,
  verified boolean not null default false,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique(user_id, wallet_address, network)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  lesson_title text,
  realm text,
  completed boolean not null default false,
  completed_at timestamptz,
  verification_status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique(user_id, lesson_id)
);

create table if not exists public.mana_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text,
  event_type text not null,
  mana_amount integer not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_name text not null,
  description text,
  lesson_source text,
  issuer text,
  wallet_address text,
  verification_hash text,
  revoked boolean not null default false,
  earned_at timestamptz not null default now()
);

create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text,
  lesson_id text,
  lesson_title text,
  realm text,
  mana_awarded integer default 0,
  verification_status text not null default 'pending',
  credential_payload jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now()
);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  wallet_address text,
  event_type text not null,
  risk_level text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.wallet_connections enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.mana_events enable row level security;
alter table public.badges enable row level security;
alter table public.credentials enable row level security;
alter table public.security_events enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_upsert_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "wallet_connections_select_own" on public.wallet_connections
  for select using (auth.uid() = user_id);
create policy "wallet_connections_insert_own" on public.wallet_connections
  for insert with check (auth.uid() = user_id);
create policy "wallet_connections_update_own" on public.wallet_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "wallet_connections_delete_own" on public.wallet_connections
  for delete using (auth.uid() = user_id);

create policy "lesson_progress_select_own" on public.lesson_progress
  for select using (auth.uid() = user_id);
create policy "lesson_progress_insert_own" on public.lesson_progress
  for insert with check (auth.uid() = user_id);
create policy "lesson_progress_update_own" on public.lesson_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "mana_events_select_own" on public.mana_events
  for select using (auth.uid() = user_id);
create policy "mana_events_insert_own" on public.mana_events
  for insert with check (auth.uid() = user_id);

create policy "badges_select_own" on public.badges
  for select using (auth.uid() = user_id);
create policy "badges_insert_own" on public.badges
  for insert with check (auth.uid() = user_id);
create policy "badges_update_own" on public.badges
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "credentials_select_own" on public.credentials
  for select using (auth.uid() = user_id);
create policy "credentials_insert_own" on public.credentials
  for insert with check (auth.uid() = user_id);

create policy "security_events_select_own" on public.security_events
  for select using (auth.uid() = user_id);
create policy "security_events_insert_own_or_null" on public.security_events
  for insert with check (auth.uid() = user_id or user_id is null);

create index if not exists idx_wallet_connections_user_id on public.wallet_connections(user_id);
create index if not exists idx_mana_events_user_id_created_at on public.mana_events(user_id, created_at desc);
create index if not exists idx_security_events_user_created_at on public.security_events(user_id, created_at desc);
create index if not exists idx_lesson_progress_user_id on public.lesson_progress(user_id);
create index if not exists idx_badges_user_id on public.badges(user_id);
create index if not exists idx_credentials_user_id on public.credentials(user_id);
