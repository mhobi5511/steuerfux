create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
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
    business_country,
    reporting_currency,
    theme_mode,
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
    extract(year from now())::int,
    'Deutschland',
    'EUR',
    'system',
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_owner_name text,
  business_year integer not null check (business_year between 2020 and 2100),
  business_country text not null check (business_country in ('Deutschland', 'Schweiz')),
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  theme_mode text not null default 'system' check (theme_mode in ('hell', 'dunkel', 'system')),
  default_home_address text not null,
  default_currency text not null check (default_currency in ('EUR', 'CHF')),
  default_manual_chf_eur_rate numeric(12,6) not null default 1 check (default_manual_chf_eur_rate > 0),
  kleinunternehmer_mode boolean not null default true,
  default_tax_mode text not null check (default_tax_mode in ('NETTO', 'BRUTTO')),
  estimated_tax_rate numeric(5,2) not null default 0 check (estimated_tax_rate between 0 and 100),
  steuerberater_view boolean not null default false
);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rate_date date not null,
  base_currency text not null check (base_currency in ('EUR', 'CHF')),
  quote_currency text not null check (quote_currency in ('EUR', 'CHF')),
  rate numeric(12,6) not null check (rate > 0),
  source text not null,
  unique (user_id, rate_date, base_currency, quote_currency)
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invoice_date date not null,
  payment_date date,
  customer_project text not null,
  category text not null,
  invoice_amount_original numeric(14,2) not null default 0 check (invoice_amount_original >= 0),
  payment_received_original numeric(14,2) not null default 0 check (payment_received_original >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1 check (exchange_rate > 0),
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  invoice_amount_reporting numeric(14,2) not null default 0 check (invoice_amount_reporting >= 0),
  payment_received_reporting numeric(14,2) not null default 0 check (payment_received_reporting >= 0),
  difference_original numeric(14,2) not null default 0,
  difference_reporting numeric(14,2) not null default 0,
  status text not null check (status in ('offen', 'bezahlt', 'teilweise bezahlt')),
  description text,
  unique (id, user_id)
);

create table if not exists public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reimbursement_date date not null,
  description text not null,
  original_amount numeric(14,2) not null default 0 check (original_amount >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1 check (exchange_rate > 0),
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  amount_reporting numeric(14,2) not null default 0 check (amount_reporting >= 0),
  context_type text not null check (context_type in ('Reise', 'Fahrt', 'Ausgabe', 'Rechnung/Einnahme')),
  linked_record_id uuid,
  status text not null check (status in ('offen', 'abgerechnet', 'bezahlt')),
  note text,
  source_expense_id uuid,
  source_trip_id uuid
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expense_date date not null,
  payment_date date,
  category text not null,
  description text not null,
  original_amount numeric(14,2) not null default 0 check (original_amount >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1 check (exchange_rate > 0),
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  amount_reporting numeric(14,2) not null default 0 check (amount_reporting >= 0),
  deductible boolean not null default true,
  deductible_percentage numeric(5,2) not null default 100 check (deductible_percentage between 0 and 100),
  deductible_amount_reporting numeric(14,2) not null default 0 check (deductible_amount_reporting >= 0),
  receipt_available boolean not null default false,
  note text,
  is_depreciable boolean not null default false,
  acquisition_value numeric(14,2) check (acquisition_value is null or acquisition_value >= 0),
  acquisition_date date,
  useful_life_years integer check (useful_life_years is null or useful_life_years >= 1),
  depreciation_method text,
  depreciation_warning text,
  reimbursable_to_client boolean not null default false,
  client_share_percentage numeric(5,2) not null default 0 check (client_share_percentage between 0 and 100),
  client_share_mode text not null default 'fixed' check (client_share_mode in ('percentage', 'fixed')),
  client_share_fixed_amount numeric(14,2) check (client_share_fixed_amount is null or client_share_fixed_amount >= 0),
  client_share_fixed_currency text check (client_share_fixed_currency is null or client_share_fixed_currency in ('EUR', 'CHF')),
  client_share_fixed_exchange_rate numeric(12,6) check (client_share_fixed_exchange_rate is null or client_share_fixed_exchange_rate > 0),
  client_share_fixed_exchange_rate_manual boolean not null default false,
  client_share_amount_original numeric(14,2) not null default 0 check (client_share_amount_original >= 0),
  client_share_amount_reporting numeric(14,2) not null default 0 check (client_share_amount_reporting >= 0),
  effective_amount_reporting numeric(14,2) not null default 0 check (effective_amount_reporting >= 0),
  effective_deductible_amount_reporting numeric(14,2) not null default 0 check (effective_deductible_amount_reporting >= 0),
  reimbursement_id uuid,
  unique (id, user_id)
);

create table if not exists public.bank_fees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fee_date date not null,
  original_amount numeric(14,2) not null default 0 check (original_amount >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  fee_type text not null check (fee_type in ('Bankgebühr', 'Wechselkursverlust', 'Zahlungsanbieter', 'Zahlungsdifferenz aus Einnahme', 'Sonstiges')),
  description text,
  exchange_rate numeric(12,6) not null default 1 check (exchange_rate > 0),
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  amount_reporting numeric(14,2) not null default 0 check (amount_reporting >= 0),
  related_income_id uuid references public.incomes(id) on delete set null,
  unique (related_income_id, fee_type)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  business_reason text not null,
  start_point text not null,
  start_at timestamptz not null,
  end_point text not null,
  end_at timestamptz not null,
  note text,
  total_km numeric(10,1) not null default 0 check (total_km >= 0),
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  driving_deduction_reporting numeric(14,2) not null default 0 check (driving_deduction_reporting >= 0),
  total_travel_expenses_reporting numeric(14,2) not null default 0 check (total_travel_expenses_reporting >= 0),
  total_per_diem_reporting numeric(14,2) not null default 0 check (total_per_diem_reporting >= 0),
  deductible_total_reporting numeric(14,2) not null default 0 check (deductible_total_reporting >= 0),
  mixed_trip_warning text,
  per_diem_breakdown jsonb not null default '[]'::jsonb,
  reimbursable_to_client boolean not null default false,
  reimbursement_id uuid,
  check (end_at >= start_at),
  unique (id, user_id)
);

create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trip_id uuid not null,
  sort_order integer not null check (sort_order >= 1),
  location text not null,
  country text not null,
  arrival_at timestamptz not null,
  departure_at timestamptz not null,
  purpose text not null check (purpose in ('Geschäftlich', 'Übernachtung geschäftlich', 'Privat', 'Transit')),
  breakfast_provided boolean not null default false,
  lunch_provided boolean not null default false,
  dinner_provided boolean not null default false,
  note text,
  check (departure_at >= arrival_at),
  constraint trip_stops_trip_fk
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade
);

create table if not exists public.trip_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trip_id uuid not null,
  sort_order integer not null check (sort_order >= 1),
  from_label text not null,
  to_label text not null,
  kilometers numeric(10,1) not null default 0 check (kilometers >= 0),
  is_business boolean not null default true,
  deduction_reporting numeric(14,2) not null default 0 check (deduction_reporting >= 0),
  note text,
  constraint trip_segments_trip_fk
    foreign key (trip_id, user_id)
    references public.trips (id, user_id)
    on delete cascade
);

create table if not exists public.depreciations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_expense_id uuid references public.expenses(id) on delete set null,
  description text not null,
  original_amount numeric(14,2) not null default 0 check (original_amount >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  exchange_rate numeric(12,6) not null default 1 check (exchange_rate > 0),
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  amount_reporting numeric(14,2) not null default 0 check (amount_reporting >= 0),
  acquisition_date date not null,
  useful_life_years integer not null check (useful_life_years >= 1),
  yearly_amount_reporting numeric(14,2) not null default 0 check (yearly_amount_reporting >= 0),
  deducted_until_year_reporting numeric(14,2) not null default 0 check (deducted_until_year_reporting >= 0),
  remaining_value_reporting numeric(14,2) not null default 0 check (remaining_value_reporting >= 0),
  remaining_years integer not null default 0 check (remaining_years >= 0),
  method text not null check (method in ('linear')),
  note text
);

alter table public.expenses add constraint expenses_reimbursement_fk foreign key (reimbursement_id) references public.reimbursements(id) on delete set null;
alter table public.trips add constraint trips_reimbursement_fk foreign key (reimbursement_id) references public.reimbursements(id) on delete set null;
alter table public.reimbursements add constraint reimbursements_source_expense_fk foreign key (source_expense_id) references public.expenses(id) on delete set null;
alter table public.reimbursements add constraint reimbursements_source_trip_fk foreign key (source_trip_id) references public.trips(id) on delete set null;

create index if not exists idx_settings_user_id on public.settings (user_id);

create index if not exists idx_exchange_rates_user_id on public.exchange_rates (user_id);
create index if not exists idx_exchange_rates_rate_date on public.exchange_rates (rate_date);
create index if not exists idx_exchange_rates_user_id_rate_date on public.exchange_rates (user_id, rate_date desc);

create index if not exists idx_incomes_user_id on public.incomes (user_id);
create index if not exists idx_incomes_invoice_date on public.incomes (invoice_date);
create index if not exists idx_incomes_payment_date on public.incomes (payment_date);
create index if not exists idx_incomes_user_id_invoice_date on public.incomes (user_id, invoice_date desc);

create index if not exists idx_expenses_user_id on public.expenses (user_id);
create index if not exists idx_expenses_expense_date on public.expenses (expense_date);
create index if not exists idx_expenses_payment_date on public.expenses (payment_date);
create index if not exists idx_expenses_reimbursement_id on public.expenses (reimbursement_id);
create index if not exists idx_expenses_user_id_expense_date on public.expenses (user_id, expense_date desc);

create index if not exists idx_bank_fees_user_id on public.bank_fees (user_id);
create index if not exists idx_bank_fees_fee_date on public.bank_fees (fee_date);
create index if not exists idx_bank_fees_related_income_id on public.bank_fees (related_income_id);
create index if not exists idx_bank_fees_user_id_fee_date on public.bank_fees (user_id, fee_date desc);

create index if not exists idx_trips_user_id on public.trips (user_id);
create index if not exists idx_trips_start_at on public.trips (start_at);
create index if not exists idx_trips_end_at on public.trips (end_at);
create index if not exists idx_trips_reimbursement_id on public.trips (reimbursement_id);
create index if not exists idx_trips_user_id_start_at on public.trips (user_id, start_at desc);

create index if not exists idx_trip_stops_user_id on public.trip_stops (user_id);
create index if not exists idx_trip_stops_trip_id on public.trip_stops (trip_id);
create index if not exists idx_trip_stops_arrival_at on public.trip_stops (arrival_at);
create index if not exists idx_trip_stops_departure_at on public.trip_stops (departure_at);
create index if not exists idx_trip_stops_trip_id_sort_order on public.trip_stops (trip_id, sort_order);

create index if not exists idx_trip_segments_user_id on public.trip_segments (user_id);
create index if not exists idx_trip_segments_trip_id on public.trip_segments (trip_id);
create index if not exists idx_trip_segments_trip_id_sort_order on public.trip_segments (trip_id, sort_order);

create index if not exists idx_depreciations_user_id on public.depreciations (user_id);
create index if not exists idx_depreciations_linked_expense_id on public.depreciations (linked_expense_id);
create index if not exists idx_depreciations_acquisition_date on public.depreciations (acquisition_date);
create index if not exists idx_depreciations_user_id_acquisition_date on public.depreciations (user_id, acquisition_date desc);

create index if not exists idx_reimbursements_user_id on public.reimbursements (user_id);
create index if not exists idx_reimbursements_date on public.reimbursements (reimbursement_date);
create index if not exists idx_reimbursements_status on public.reimbursements (status);
create index if not exists idx_reimbursements_source_expense_id on public.reimbursements (source_expense_id);
create index if not exists idx_reimbursements_source_trip_id on public.reimbursements (source_trip_id);

drop trigger if exists set_updated_at_settings on public.settings;
create trigger set_updated_at_settings before update on public.settings for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_exchange_rates on public.exchange_rates;
create trigger set_updated_at_exchange_rates before update on public.exchange_rates for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_incomes on public.incomes;
create trigger set_updated_at_incomes before update on public.incomes for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_reimbursements on public.reimbursements;
create trigger set_updated_at_reimbursements before update on public.reimbursements for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_expenses on public.expenses;
create trigger set_updated_at_expenses before update on public.expenses for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_bank_fees on public.bank_fees;
create trigger set_updated_at_bank_fees before update on public.bank_fees for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_trips on public.trips;
create trigger set_updated_at_trips before update on public.trips for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_trip_stops on public.trip_stops;
create trigger set_updated_at_trip_stops before update on public.trip_stops for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_trip_segments on public.trip_segments;
create trigger set_updated_at_trip_segments before update on public.trip_segments for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_depreciations on public.depreciations;
create trigger set_updated_at_depreciations before update on public.depreciations for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

alter table public.settings enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.incomes enable row level security;
alter table public.reimbursements enable row level security;
alter table public.expenses enable row level security;
alter table public.bank_fees enable row level security;
alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;
alter table public.trip_segments enable row level security;
alter table public.depreciations enable row level security;

drop policy if exists settings_select_own on public.settings;
create policy settings_select_own on public.settings for select using (auth.uid() = user_id);
drop policy if exists settings_insert_own on public.settings;
create policy settings_insert_own on public.settings for insert with check (auth.uid() = user_id);
drop policy if exists settings_update_own on public.settings;
create policy settings_update_own on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists settings_delete_own on public.settings;
create policy settings_delete_own on public.settings for delete using (auth.uid() = user_id);

drop policy if exists exchange_rates_select_own on public.exchange_rates;
create policy exchange_rates_select_own on public.exchange_rates for select using (auth.uid() = user_id);
drop policy if exists exchange_rates_insert_own on public.exchange_rates;
create policy exchange_rates_insert_own on public.exchange_rates for insert with check (auth.uid() = user_id);
drop policy if exists exchange_rates_update_own on public.exchange_rates;
create policy exchange_rates_update_own on public.exchange_rates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists exchange_rates_delete_own on public.exchange_rates;
create policy exchange_rates_delete_own on public.exchange_rates for delete using (auth.uid() = user_id);

drop policy if exists incomes_select_own on public.incomes;
create policy incomes_select_own on public.incomes for select using (auth.uid() = user_id);
drop policy if exists incomes_insert_own on public.incomes;
create policy incomes_insert_own on public.incomes for insert with check (auth.uid() = user_id);
drop policy if exists incomes_update_own on public.incomes;
create policy incomes_update_own on public.incomes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists incomes_delete_own on public.incomes;
create policy incomes_delete_own on public.incomes for delete using (auth.uid() = user_id);

drop policy if exists reimbursements_select_own on public.reimbursements;
create policy reimbursements_select_own on public.reimbursements for select using (auth.uid() = user_id);
drop policy if exists reimbursements_insert_own on public.reimbursements;
create policy reimbursements_insert_own on public.reimbursements for insert with check (auth.uid() = user_id);
drop policy if exists reimbursements_update_own on public.reimbursements;
create policy reimbursements_update_own on public.reimbursements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists reimbursements_delete_own on public.reimbursements;
create policy reimbursements_delete_own on public.reimbursements for delete using (auth.uid() = user_id);

drop policy if exists expenses_select_own on public.expenses;
create policy expenses_select_own on public.expenses for select using (auth.uid() = user_id);
drop policy if exists expenses_insert_own on public.expenses;
create policy expenses_insert_own on public.expenses for insert with check (auth.uid() = user_id);
drop policy if exists expenses_update_own on public.expenses;
create policy expenses_update_own on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists expenses_delete_own on public.expenses;
create policy expenses_delete_own on public.expenses for delete using (auth.uid() = user_id);

drop policy if exists bank_fees_select_own on public.bank_fees;
create policy bank_fees_select_own on public.bank_fees for select using (auth.uid() = user_id);
drop policy if exists bank_fees_insert_own on public.bank_fees;
create policy bank_fees_insert_own on public.bank_fees for insert with check (auth.uid() = user_id);
drop policy if exists bank_fees_update_own on public.bank_fees;
create policy bank_fees_update_own on public.bank_fees for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists bank_fees_delete_own on public.bank_fees;
create policy bank_fees_delete_own on public.bank_fees for delete using (auth.uid() = user_id);

drop policy if exists trips_select_own on public.trips;
create policy trips_select_own on public.trips for select using (auth.uid() = user_id);
drop policy if exists trips_insert_own on public.trips;
create policy trips_insert_own on public.trips for insert with check (auth.uid() = user_id);
drop policy if exists trips_update_own on public.trips;
create policy trips_update_own on public.trips for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists trips_delete_own on public.trips;
create policy trips_delete_own on public.trips for delete using (auth.uid() = user_id);

drop policy if exists trip_stops_select_own on public.trip_stops;
create policy trip_stops_select_own on public.trip_stops for select using (auth.uid() = user_id);
drop policy if exists trip_stops_insert_own on public.trip_stops;
create policy trip_stops_insert_own on public.trip_stops for insert with check (auth.uid() = user_id);
drop policy if exists trip_stops_update_own on public.trip_stops;
create policy trip_stops_update_own on public.trip_stops for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists trip_stops_delete_own on public.trip_stops;
create policy trip_stops_delete_own on public.trip_stops for delete using (auth.uid() = user_id);

drop policy if exists trip_segments_select_own on public.trip_segments;
create policy trip_segments_select_own on public.trip_segments for select using (auth.uid() = user_id);
drop policy if exists trip_segments_insert_own on public.trip_segments;
create policy trip_segments_insert_own on public.trip_segments for insert with check (auth.uid() = user_id);
drop policy if exists trip_segments_update_own on public.trip_segments;
create policy trip_segments_update_own on public.trip_segments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists trip_segments_delete_own on public.trip_segments;
create policy trip_segments_delete_own on public.trip_segments for delete using (auth.uid() = user_id);

drop policy if exists depreciations_select_own on public.depreciations;
create policy depreciations_select_own on public.depreciations for select using (auth.uid() = user_id);
drop policy if exists depreciations_insert_own on public.depreciations;
create policy depreciations_insert_own on public.depreciations for insert with check (auth.uid() = user_id);
drop policy if exists depreciations_update_own on public.depreciations;
create policy depreciations_update_own on public.depreciations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists depreciations_delete_own on public.depreciations;
create policy depreciations_delete_own on public.depreciations for delete using (auth.uid() = user_id);
