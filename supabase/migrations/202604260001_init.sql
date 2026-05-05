create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.settings (
    user_id,
    business_owner_name,
    business_year,
    default_home_address,
    default_currency,
    default_manual_chf_eur_rate,
    kleinunternehmer_mode,
    default_tax_mode,
    estimated_tax_rate,
    steuerberater_view
  )
  values (
    new.id,
    null,
    extract(year from timezone('utc', now()))::int,
    'Ottobrunn, München, Deutschland',
    'EUR',
    1,
    true,
    'BRUTTO',
    0,
    false
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  business_owner_name text,
  business_year int not null,
  default_home_address text not null,
  default_currency text not null check (default_currency in ('EUR', 'CHF')),
  default_manual_chf_eur_rate numeric(12,6) not null default 1,
  kleinunternehmer_mode boolean not null default true,
  default_tax_mode text not null check (default_tax_mode in ('NETTO', 'BRUTTO')),
  estimated_tax_rate numeric(5,2) not null default 0 check (estimated_tax_rate between 0 and 100),
  steuerberater_view boolean not null default false
);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  rate_date date not null,
  base_currency text not null check (base_currency in ('EUR', 'CHF')),
  quote_currency text not null check (quote_currency in ('EUR', 'CHF')),
  rate numeric(12,6) not null,
  source text not null,
  unique (user_id, rate_date, base_currency, quote_currency)
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  invoice_date date not null,
  payment_date date,
  customer_project text not null,
  category text not null,
  invoice_amount_original numeric(14,2) not null default 0,
  payment_received_original numeric(14,2) not null default 0,
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1,
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  invoice_amount_eur numeric(14,2) not null default 0,
  payment_received_eur numeric(14,2) not null default 0,
  difference_original numeric(14,2) not null default 0,
  difference_eur numeric(14,2) not null default 0,
  status text not null check (status in ('offen', 'bezahlt', 'teilweise bezahlt')),
  description text
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  expense_date date not null,
  payment_date date,
  category text not null,
  description text not null,
  original_amount numeric(14,2) not null default 0,
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1,
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  eur_amount numeric(14,2) not null default 0,
  deductible boolean not null default true,
  deductible_percentage numeric(5,2) not null default 100,
  deductible_amount_eur numeric(14,2) not null default 0,
  receipt_available boolean not null default false,
  note text,
  is_depreciable boolean not null default false,
  acquisition_value numeric(14,2),
  acquisition_date date,
  useful_life_years int,
  depreciation_method text,
  depreciation_warning text
);

create table if not exists public.bank_fees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  fee_date date not null,
  original_amount numeric(14,2) not null default 0,
  currency text not null check (currency in ('EUR', 'CHF')),
  fee_type text not null check (fee_type in ('Bankgebühr', 'Wechselkursverlust', 'Zahlungsanbieter', 'Zahlungsdifferenz aus Einnahme', 'Sonstiges')),
  description text,
  exchange_rate numeric(12,6) not null default 1,
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  eur_amount numeric(14,2) not null default 0,
  related_income_id uuid,
  unique nulls not distinct (related_income_id, fee_type)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  title text not null,
  business_reason text not null,
  start_point text not null,
  start_at timestamptz not null,
  end_point text not null,
  end_at timestamptz not null,
  note text,
  total_km numeric(10,1) not null default 0,
  driving_deduction_eur numeric(14,2) not null default 0,
  total_travel_expenses_eur numeric(14,2) not null default 0,
  total_per_diem_eur numeric(14,2) not null default 0,
  deductible_total_eur numeric(14,2) not null default 0,
  mixed_trip_warning text
);

create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sort_order int not null,
  location text not null,
  country text not null,
  arrival_at timestamptz not null,
  departure_at timestamptz not null,
  purpose text not null check (purpose in ('Geschäftlich', 'Übernachtung geschäftlich', 'Privat', 'Transit')),
  breakfast_provided boolean not null default false,
  lunch_provided boolean not null default false,
  dinner_provided boolean not null default false,
  note text
);

create table if not exists public.trip_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sort_order int not null,
  from_label text not null,
  to_label text not null,
  kilometers numeric(10,1) not null default 0,
  is_business boolean not null default true,
  deduction_eur numeric(14,2) not null default 0,
  note text
);

create table if not exists public.depreciations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  linked_expense_id uuid references public.expenses(id) on delete set null,
  description text not null,
  original_amount numeric(14,2) not null default 0,
  currency text not null check (currency in ('EUR', 'CHF')),
  exchange_rate numeric(12,6) not null default 1,
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  eur_amount numeric(14,2) not null default 0,
  acquisition_date date not null,
  useful_life_years int not null,
  yearly_amount_eur numeric(14,2) not null default 0,
  deducted_until_year_eur numeric(14,2) not null default 0,
  remaining_value_eur numeric(14,2) not null default 0,
  remaining_years int not null default 0,
  method text not null check (method in ('linear')),
  note text
);

create table if not exists public.yearly_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  export_year int not null,
  export_type text not null,
  storage_path text,
  metadata jsonb
);

create trigger set_updated_at_settings before update on public.settings for each row execute function public.set_updated_at();
create trigger set_updated_at_exchange_rates before update on public.exchange_rates for each row execute function public.set_updated_at();
create trigger set_updated_at_incomes before update on public.incomes for each row execute function public.set_updated_at();
create trigger set_updated_at_expenses before update on public.expenses for each row execute function public.set_updated_at();
create trigger set_updated_at_bank_fees before update on public.bank_fees for each row execute function public.set_updated_at();
create trigger set_updated_at_trips before update on public.trips for each row execute function public.set_updated_at();
create trigger set_updated_at_trip_stops before update on public.trip_stops for each row execute function public.set_updated_at();
create trigger set_updated_at_trip_segments before update on public.trip_segments for each row execute function public.set_updated_at();
create trigger set_updated_at_depreciations before update on public.depreciations for each row execute function public.set_updated_at();
create trigger set_updated_at_yearly_exports before update on public.yearly_exports for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.settings enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.bank_fees enable row level security;
alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;
alter table public.trip_segments enable row level security;
alter table public.depreciations enable row level security;
alter table public.yearly_exports enable row level security;

create policy "settings own rows" on public.settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exchange rates own rows" on public.exchange_rates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "incomes own rows" on public.incomes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "expenses own rows" on public.expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bank fees own rows" on public.bank_fees for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips own rows" on public.trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trip stops own rows" on public.trip_stops for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trip segments own rows" on public.trip_segments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "depreciations own rows" on public.depreciations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "yearly exports own rows" on public.yearly_exports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
