-- Additive, Buchhaltung-scoped presets for recurring trips.
-- Templates are not accounting records and have no foreign key to trips.
-- This migration does not read, update, backfill, or delete historical trips.

create table if not exists public.trip_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  title text not null,
  business_reason text not null default '',
  start_point text not null,
  end_point text not null,
  stops jsonb not null default '[]'::jsonb check (jsonb_typeof(stops) = 'array'),
  segments jsonb not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_templates_buchhaltung_fk
    foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen (id, user_id),
  constraint trip_templates_book_name_unique unique (buchhaltung_id, name)
);

create index if not exists idx_trip_templates_user_book
  on public.trip_templates (user_id, buchhaltung_id, name);

alter table public.trip_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at_trip_templates'
      and tgrelid = 'public.trip_templates'::regclass
  ) then
    create trigger set_updated_at_trip_templates
      before update on public.trip_templates
      for each row execute function public.set_updated_at();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_templates'
      and policyname = 'trip_templates_select_own'
  ) then
    create policy trip_templates_select_own on public.trip_templates
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_templates'
      and policyname = 'trip_templates_insert_own'
  ) then
    create policy trip_templates_insert_own on public.trip_templates
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_templates'
      and policyname = 'trip_templates_update_own'
  ) then
    create policy trip_templates_update_own on public.trip_templates
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_templates'
      and policyname = 'trip_templates_delete_own'
  ) then
    create policy trip_templates_delete_own on public.trip_templates
      for delete using (auth.uid() = user_id);
  end if;
end
$$;
