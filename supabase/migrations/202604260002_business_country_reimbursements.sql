create extension if not exists "pgcrypto";

alter table public.settings
  add column if not exists business_country text not null default 'Deutschland',
  add column if not exists theme_mode text not null default 'system',
  add column if not exists reporting_currency text not null default 'EUR';

alter table public.settings
  drop constraint if exists settings_business_country_check,
  add constraint settings_business_country_check check (business_country in ('Deutschland', 'Schweiz'));

alter table public.settings
  drop constraint if exists settings_reporting_currency_check,
  add constraint settings_reporting_currency_check check (reporting_currency in ('EUR', 'CHF'));

alter table public.settings
  drop constraint if exists settings_theme_mode_check,
  add constraint settings_theme_mode_check check (theme_mode in ('hell', 'dunkel', 'system'));

alter table public.incomes
  add column if not exists reporting_currency text not null default 'EUR',
  add column if not exists invoice_amount_reporting numeric(14,2) not null default 0,
  add column if not exists payment_received_reporting numeric(14,2) not null default 0,
  add column if not exists difference_reporting numeric(14,2) not null default 0;

alter table public.expenses
  add column if not exists reporting_currency text not null default 'EUR',
  add column if not exists amount_reporting numeric(14,2) not null default 0,
  add column if not exists deductible_amount_reporting numeric(14,2) not null default 0,
  add column if not exists reimbursable_to_client boolean not null default false,
  add column if not exists client_share_percentage numeric(5,2) not null default 0,
  add column if not exists client_share_amount_original numeric(14,2) not null default 0,
  add column if not exists client_share_amount_reporting numeric(14,2) not null default 0,
  add column if not exists effective_amount_reporting numeric(14,2) not null default 0,
  add column if not exists effective_deductible_amount_reporting numeric(14,2) not null default 0,
  add column if not exists reimbursement_id uuid;

alter table public.bank_fees
  add column if not exists reporting_currency text not null default 'EUR',
  add column if not exists amount_reporting numeric(14,2) not null default 0;

alter table public.trips
  add column if not exists reporting_currency text not null default 'EUR',
  add column if not exists driving_deduction_reporting numeric(14,2) not null default 0,
  add column if not exists total_travel_expenses_reporting numeric(14,2) not null default 0,
  add column if not exists total_per_diem_reporting numeric(14,2) not null default 0,
  add column if not exists deductible_total_reporting numeric(14,2) not null default 0,
  add column if not exists per_diem_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists reimbursable_to_client boolean not null default false,
  add column if not exists reimbursement_id uuid;

alter table public.trip_segments
  add column if not exists deduction_reporting numeric(14,2) not null default 0;

alter table public.depreciations
  add column if not exists reporting_currency text not null default 'EUR',
  add column if not exists amount_reporting numeric(14,2) not null default 0,
  add column if not exists yearly_amount_reporting numeric(14,2) not null default 0,
  add column if not exists deducted_until_year_reporting numeric(14,2) not null default 0,
  add column if not exists remaining_value_reporting numeric(14,2) not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'incomes' and column_name = 'invoice_amount_eur'
  ) then
    execute '
      update public.incomes
      set
        invoice_amount_reporting = coalesce(nullif(invoice_amount_reporting, 0), invoice_amount_eur, invoice_amount_original),
        payment_received_reporting = coalesce(nullif(payment_received_reporting, 0), payment_received_eur, payment_received_original),
        difference_reporting = coalesce(nullif(difference_reporting, 0), difference_eur, difference_original)
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses' and column_name = 'eur_amount'
  ) then
    execute '
      update public.expenses
      set
        amount_reporting = coalesce(nullif(amount_reporting, 0), eur_amount, original_amount),
        deductible_amount_reporting = coalesce(nullif(deductible_amount_reporting, 0), deductible_amount_eur, 0),
        effective_amount_reporting = coalesce(nullif(effective_amount_reporting, 0), eur_amount, original_amount),
        effective_deductible_amount_reporting = coalesce(nullif(effective_deductible_amount_reporting, 0), deductible_amount_eur, 0)
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_fees' and column_name = 'eur_amount'
  ) then
    execute '
      update public.bank_fees
      set amount_reporting = coalesce(nullif(amount_reporting, 0), eur_amount, original_amount)
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trips' and column_name = 'driving_deduction_eur'
  ) then
    execute '
      update public.trips
      set
        driving_deduction_reporting = coalesce(nullif(driving_deduction_reporting, 0), driving_deduction_eur, 0),
        total_travel_expenses_reporting = coalesce(nullif(total_travel_expenses_reporting, 0), total_travel_expenses_eur, 0),
        total_per_diem_reporting = coalesce(nullif(total_per_diem_reporting, 0), total_per_diem_eur, 0),
        deductible_total_reporting = coalesce(nullif(deductible_total_reporting, 0), deductible_total_eur, 0)
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trip_segments' and column_name = 'deduction_eur'
  ) then
    execute '
      update public.trip_segments
      set deduction_reporting = coalesce(nullif(deduction_reporting, 0), deduction_eur, 0)
    ';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'depreciations' and column_name = 'eur_amount'
  ) then
    execute '
      update public.depreciations
      set
        amount_reporting = coalesce(nullif(amount_reporting, 0), eur_amount, original_amount),
        yearly_amount_reporting = coalesce(nullif(yearly_amount_reporting, 0), yearly_amount_eur, 0),
        deducted_until_year_reporting = coalesce(nullif(deducted_until_year_reporting, 0), deducted_until_year_eur, 0),
        remaining_value_reporting = coalesce(nullif(remaining_value_reporting, 0), remaining_value_eur, 0)
    ';
  end if;
end $$;

update public.expenses
set
  client_share_percentage = 0,
  client_share_amount_original = 0,
  client_share_amount_reporting = 0,
  effective_amount_reporting = amount_reporting,
  effective_deductible_amount_reporting = deductible_amount_reporting
where coalesce(reimbursable_to_client, false) = false;

update public.expenses as e
set
  reimbursable_to_client = true,
  client_share_amount_original = coalesce(r.original_amount, 0),
  client_share_amount_reporting = coalesce(r.amount_reporting, 0),
  client_share_percentage = case
    when coalesce(e.original_amount, 0) > 0 then least(round((coalesce(r.original_amount, 0) / e.original_amount) * 100, 2), 100)
    else 0
  end,
  effective_amount_reporting = greatest(coalesce(e.amount_reporting, 0) - coalesce(r.amount_reporting, 0), 0),
  effective_deductible_amount_reporting = greatest(coalesce(e.deductible_amount_reporting, 0) - coalesce(r.amount_reporting, 0), 0)
from public.reimbursements as r
where r.source_expense_id = e.id
  and r.user_id = e.user_id;

create table if not exists public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reimbursement_date date not null,
  description text not null,
  original_amount numeric(14,2) not null default 0,
  currency text not null check (currency in ('EUR', 'CHF')),
  tax_mode text not null check (tax_mode in ('NETTO', 'BRUTTO')),
  exchange_rate numeric(12,6) not null default 1,
  exchange_rate_source text,
  exchange_rate_manual boolean not null default false,
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  amount_reporting numeric(14,2) not null default 0,
  context_type text not null check (context_type in ('Reise', 'Fahrt', 'Ausgabe', 'Rechnung/Einnahme')),
  linked_record_id uuid,
  status text not null check (status in ('offen', 'abgerechnet', 'bezahlt')),
  note text,
  source_expense_id uuid references public.expenses(id) on delete set null,
  source_trip_id uuid references public.trips(id) on delete set null
);

alter table public.expenses
  drop constraint if exists expenses_reimbursement_fk;
alter table public.expenses
  add constraint expenses_reimbursement_fk foreign key (reimbursement_id) references public.reimbursements(id) on delete set null;

alter table public.trips
  drop constraint if exists trips_reimbursement_fk;
alter table public.trips
  add constraint trips_reimbursement_fk foreign key (reimbursement_id) references public.reimbursements(id) on delete set null;

create index if not exists idx_reimbursements_user_id on public.reimbursements (user_id);
create index if not exists idx_reimbursements_date on public.reimbursements (reimbursement_date);
create index if not exists idx_reimbursements_status on public.reimbursements (status);
create index if not exists idx_expenses_reimbursement_id on public.expenses (reimbursement_id);
create index if not exists idx_trips_reimbursement_id on public.trips (reimbursement_id);

drop trigger if exists set_updated_at_reimbursements on public.reimbursements;
create trigger set_updated_at_reimbursements before update on public.reimbursements for each row execute function public.set_updated_at();

alter table public.reimbursements enable row level security;

drop policy if exists reimbursements_select_own on public.reimbursements;
create policy reimbursements_select_own on public.reimbursements for select using (auth.uid() = user_id);
drop policy if exists reimbursements_insert_own on public.reimbursements;
create policy reimbursements_insert_own on public.reimbursements for insert with check (auth.uid() = user_id);
drop policy if exists reimbursements_update_own on public.reimbursements;
create policy reimbursements_update_own on public.reimbursements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists reimbursements_delete_own on public.reimbursements;
create policy reimbursements_delete_own on public.reimbursements for delete using (auth.uid() = user_id);
