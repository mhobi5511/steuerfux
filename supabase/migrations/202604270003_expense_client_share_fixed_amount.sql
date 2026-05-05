alter table public.expenses
  add column if not exists client_share_mode text not null default 'fixed',
  add column if not exists client_share_fixed_amount numeric(14,2),
  add column if not exists client_share_fixed_currency text,
  add column if not exists client_share_fixed_exchange_rate numeric(12,6),
  add column if not exists client_share_fixed_exchange_rate_manual boolean not null default false;

alter table public.expenses
  drop constraint if exists expenses_client_share_mode_check;

alter table public.expenses
  add constraint expenses_client_share_mode_check
  check (client_share_mode in ('percentage', 'fixed'));

alter table public.expenses
  drop constraint if exists expenses_client_share_fixed_amount_check;

alter table public.expenses
  add constraint expenses_client_share_fixed_amount_check
  check (client_share_fixed_amount is null or client_share_fixed_amount >= 0);

alter table public.expenses
  drop constraint if exists expenses_client_share_fixed_currency_check;

alter table public.expenses
  add constraint expenses_client_share_fixed_currency_check
  check (
    client_share_fixed_currency is null
    or client_share_fixed_currency in ('EUR', 'CHF')
  );

alter table public.expenses
  drop constraint if exists expenses_client_share_fixed_exchange_rate_check;

alter table public.expenses
  add constraint expenses_client_share_fixed_exchange_rate_check
  check (
    client_share_fixed_exchange_rate is null
    or client_share_fixed_exchange_rate > 0
  );
