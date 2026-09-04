-- Additive mileage settings and immutable calculation metadata.
-- This migration intentionally does not backfill or recalculate any existing trip.

create table if not exists public.buchhaltung_year_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  year integer not null check (year between 2020 and 2100),
  mileage_rate numeric(10,4) not null check (mileage_rate >= 0),
  mileage_currency text not null check (mileage_currency in ('EUR', 'CHF')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buchhaltung_year_settings_buchhaltung_fk
    foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen (id, user_id),
  constraint buchhaltung_year_settings_book_year_unique unique (buchhaltung_id, year)
);

alter table public.trips
  add column if not exists applied_mileage_rate numeric(10,4)
    check (applied_mileage_rate >= 0),
  add column if not exists applied_mileage_currency text
    check (applied_mileage_currency in ('EUR', 'CHF'));

create index if not exists idx_buchhaltung_year_settings_user_book_year
  on public.buchhaltung_year_settings (user_id, buchhaltung_id, year);

alter table public.buchhaltung_year_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at_buchhaltung_year_settings'
      and tgrelid = 'public.buchhaltung_year_settings'::regclass
  ) then
    create trigger set_updated_at_buchhaltung_year_settings
      before update on public.buchhaltung_year_settings
      for each row execute function public.set_updated_at();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'buchhaltung_year_settings'
      and policyname = 'buchhaltung_year_settings_select_own'
  ) then
    create policy buchhaltung_year_settings_select_own
      on public.buchhaltung_year_settings for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'buchhaltung_year_settings'
      and policyname = 'buchhaltung_year_settings_insert_own'
  ) then
    create policy buchhaltung_year_settings_insert_own
      on public.buchhaltung_year_settings for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'buchhaltung_year_settings'
      and policyname = 'buchhaltung_year_settings_update_own'
  ) then
    create policy buchhaltung_year_settings_update_own
      on public.buchhaltung_year_settings for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;
