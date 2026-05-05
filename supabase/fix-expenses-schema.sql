-- Compatibility migration for all fields used by the expense insert/upsert logic
-- plus requested alias/compatibility columns.

alter table public.expenses add column if not exists user_id uuid;
alter table public.expenses add column if not exists expense_date date;
alter table public.expenses add column if not exists payment_date date;
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists description text;

alter table public.expenses add column if not exists original_amount numeric(14,2);
alter table public.expenses add column if not exists amount_original numeric(14,2);
alter table public.expenses add column if not exists amount_reporting numeric(14,2);
alter table public.expenses add column if not exists effective_amount_original numeric(14,2);
alter table public.expenses add column if not exists effective_amount_reporting numeric(14,2);
alter table public.expenses add column if not exists deductible_amount_original numeric(14,2);
alter table public.expenses add column if not exists deductible_amount_reporting numeric(14,2);
alter table public.expenses add column if not exists effective_deductible_amount_original numeric(14,2);
alter table public.expenses add column if not exists effective_deductible_amount_reporting numeric(14,2);
alter table public.expenses add column if not exists client_share_percentage numeric(5,2);
alter table public.expenses add column if not exists client_share_mode text;
alter table public.expenses add column if not exists client_share_fixed_amount numeric(14,2);
alter table public.expenses add column if not exists client_share_fixed_currency text;
alter table public.expenses add column if not exists client_share_fixed_exchange_rate numeric(12,6);
alter table public.expenses add column if not exists client_share_fixed_exchange_rate_manual boolean;
alter table public.expenses add column if not exists client_share_amount_original numeric(14,2);
alter table public.expenses add column if not exists client_share_amount_reporting numeric(14,2);
alter table public.expenses add column if not exists acquisition_value numeric(14,2);

alter table public.expenses add column if not exists currency text;
alter table public.expenses add column if not exists reporting_currency text;
alter table public.expenses add column if not exists tax_mode text;
alter table public.expenses add column if not exists net_gross text;
alter table public.expenses add column if not exists exchange_rate numeric(12,6);
alter table public.expenses add column if not exists exchange_rate_source text;
alter table public.expenses add column if not exists depreciation_method text;
alter table public.expenses add column if not exists depreciation_warning text;
alter table public.expenses add column if not exists reimbursement_status text;
alter table public.expenses add column if not exists note text;

alter table public.expenses add column if not exists exchange_rate_manual boolean;
alter table public.expenses add column if not exists deductible boolean;
alter table public.expenses add column if not exists receipt_available boolean;
alter table public.expenses add column if not exists is_depreciable boolean;
alter table public.expenses add column if not exists reimbursable_to_client boolean;
alter table public.expenses add column if not exists is_reimbursable boolean;

alter table public.expenses add column if not exists deductible_percentage numeric(5,2);
alter table public.expenses add column if not exists useful_life_years integer;

alter table public.expenses add column if not exists acquisition_date date;
alter table public.expenses add column if not exists reimbursement_id uuid;
