-- Project Bird Dog - Supabase schema and RLS
-- Run this in Supabase SQL editor before starting the app.

create extension if not exists pgcrypto;

create table if not exists public.scout_users (
  id text primary key,
  org_id text not null,
  name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.scout_notes (
  id text primary key,
  org_id text not null,
  user_id text not null,
  game_id text not null,
  player_id text,
  transcript text not null,
  audio_url text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_events (
  id text primary key,
  org_id text not null,
  user_id text not null,
  game_id text not null,
  message text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.harvest_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  company text not null check (company in ('PG', 'PBR')),
  tournament_hint text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')) default 'queued',
  created_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  worker_error text
);

create table if not exists public.harvested_tournaments (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  company text not null check (company in ('PG', 'PBR')),
  external_id text not null,
  name text not null,
  city text,
  event_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, company, external_id)
);

create table if not exists public.harvested_games (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  tournament_id uuid not null references public.harvested_tournaments(id) on delete cascade,
  external_id text not null,
  field_name text not null,
  field_x double precision,
  field_y double precision,
  start_time timestamptz not null,
  home_team text not null,
  away_team text not null,
  created_at timestamptz not null default now(),
  unique (org_id, tournament_id, external_id)
);

create table if not exists public.harvested_players (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  external_id text not null,
  name text not null,
  school text,
  position text,
  must_see boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, external_id)
);

create table if not exists public.harvested_rosters (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  tournament_id uuid not null references public.harvested_tournaments(id) on delete cascade,
  game_id uuid not null references public.harvested_games(id) on delete cascade,
  player_id uuid not null references public.harvested_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (org_id, game_id, player_id)
);

create index if not exists idx_scout_notes_org_created on public.scout_notes (org_id, created_at desc);
create index if not exists idx_pulse_events_org_created on public.pulse_events (org_id, created_at desc);
create index if not exists idx_harvest_jobs_org_created on public.harvest_jobs (org_id, created_at desc);
create index if not exists idx_harvested_tournaments_org_company on public.harvested_tournaments (org_id, company, event_date);
create index if not exists idx_harvested_games_org_tournament on public.harvested_games (org_id, tournament_id, start_time);
create index if not exists idx_harvested_rosters_org_tournament on public.harvested_rosters (org_id, tournament_id);

alter table public.scout_users enable row level security;
alter table public.scout_notes enable row level security;
alter table public.pulse_events enable row level security;
alter table public.harvest_jobs enable row level security;
alter table public.harvested_tournaments enable row level security;
alter table public.harvested_games enable row level security;
alter table public.harvested_players enable row level security;
alter table public.harvested_rosters enable row level security;

-- JWT should contain org_id claim for app clients.
create policy "scout_users_org_read"
  on public.scout_users for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "scout_users_org_write"
  on public.scout_users for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "scout_notes_org_read"
  on public.scout_notes for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "scout_notes_org_write"
  on public.scout_notes for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "pulse_events_org_read"
  on public.pulse_events for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "pulse_events_org_write"
  on public.pulse_events for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvest_jobs_org_read"
  on public.harvest_jobs for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvest_jobs_org_write"
  on public.harvest_jobs for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_tournaments_org_read"
  on public.harvested_tournaments for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_tournaments_org_write"
  on public.harvested_tournaments for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_games_org_read"
  on public.harvested_games for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_games_org_write"
  on public.harvested_games for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_players_org_read"
  on public.harvested_players for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_players_org_write"
  on public.harvested_players for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_rosters_org_read"
  on public.harvested_rosters for select
  using (org_id = coalesce(auth.jwt() ->> 'org_id', ''));

create policy "harvested_rosters_org_write"
  on public.harvested_rosters for insert
  with check (org_id = coalesce(auth.jwt() ->> 'org_id', ''));
