-- Run this in Supabase → SQL Editor → New query → paste → Run.
-- This replaces any previous schema. Safe to re-run.

-- 1. Drop old auth-based setup if present
drop table if exists public.votes cascade;
drop table if exists public.dashboards cascade;

-- 2. Dashboards
create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  theme text,
  data_source_url text,
  notes text,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'data_not_available', 'completed')),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Votes — one row per (dashboard, voter). Re-voting toggles via delete.
create table public.votes (
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (dashboard_id, user_name)
);

create index votes_dashboard_id_idx on public.votes(dashboard_id);

-- 4. updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dashboards_set_updated_at on public.dashboards;
create trigger dashboards_set_updated_at
  before update on public.dashboards
  for each row
  execute function public.set_updated_at();

-- 5. Permissive RLS for anon role (access is gated client-side by shared password)
alter table public.dashboards enable row level security;
alter table public.votes enable row level security;

drop policy if exists "anon all" on public.dashboards;
drop policy if exists "anon all" on public.votes;

create policy "anon all" on public.dashboards
  for all to anon using (true) with check (true);

create policy "anon all" on public.votes
  for all to anon using (true) with check (true);

-- 6. Realtime so all browsers see live updates
alter publication supabase_realtime add table public.dashboards;
alter publication supabase_realtime add table public.votes;
