alter table public.incomes add column if not exists invoice_id uuid;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  company_name text not null,
  contact_name text,
  street text not null,
  postal_code text not null,
  city text not null,
  country text not null,
  email text not null,
  phone text,
  customer_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade,
  unique (id, user_id)
);

create table if not exists public.invoice_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  sender_name text,
  sender_addition text,
  sender_street text,
  sender_postal_code text,
  sender_city text,
  sender_country text,
  sender_email text,
  sender_phone text,
  sender_tax_id text,
  logo_storage_path text,
  invoice_prefix text not null default 'RG',
  next_invoice_number integer not null default 1 check (next_invoice_number >= 1),
  yearly_reset boolean not null default true,
  default_payment_term text not null default '1 Monat',
  default_kleinunternehmer boolean not null default false,
  last_invoice_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_settings_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade,
  unique (buchhaltung_id)
);

insert into public.invoice_settings (
  user_id,
  buchhaltung_id,
  sender_name,
  sender_country,
  invoice_prefix,
  next_invoice_number,
  yearly_reset,
  default_payment_term,
  default_kleinunternehmer
)
select
  b.user_id,
  b.id,
  s.business_owner_name,
  b.country,
  'RG',
  1,
  true,
  '1 Monat',
  coalesce(s.kleinunternehmer_mode, false)
from public.buchhaltungen b
left join public.settings s on s.user_id = b.user_id
where not exists (
  select 1 from public.invoice_settings i where i.buchhaltung_id = b.id
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  label text not null,
  currency text not null check (currency in ('EUR', 'CHF')),
  account_holder text not null,
  iban text not null,
  bic text not null,
  bank_name text not null,
  bank_address text,
  qr_storage_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_accounts_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade,
  unique (id, user_id)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  customer_id uuid,
  bank_account_id uuid,
  invoice_number text,
  status text not null default 'Entwurf' check (status in ('Entwurf', 'Ausgestellt', 'Versendet', 'Teilweise bezahlt', 'Bezahlt', 'Storniert')),
  issue_date date not null,
  payment_term text not null,
  due_date date not null,
  currency text not null check (currency in ('EUR', 'CHF')),
  kleinunternehmer boolean not null default false,
  customer_snapshot jsonb not null default '{}'::jsonb,
  sender_snapshot jsonb not null default '{}'::jsonb,
  bank_snapshot jsonb,
  tax_note text,
  notes text,
  net_total_cents integer not null default 0,
  vat_total_cents integer not null default 0,
  gross_total_cents integer not null default 0,
  paid_total_cents integer not null default 0,
  sent_at timestamptz,
  issued_at timestamptz,
  income_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade,
  constraint invoices_customer_fk foreign key (customer_id, user_id) references public.customers (id, user_id) on delete set null,
  constraint invoices_bank_account_fk foreign key (bank_account_id, user_id) references public.bank_accounts (id, user_id) on delete set null,
  unique (id, user_id),
  unique (buchhaltung_id, invoice_number)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  sort_order integer not null check (sort_order >= 1),
  title text not null,
  description text,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  vat_rate numeric(6,3) not null default 0 check (vat_rate >= 0),
  net_amount_cents integer not null default 0,
  vat_amount_cents integer not null default 0,
  gross_amount_cents integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_items_invoice_fk foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete cascade,
  constraint invoice_items_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade
);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  income_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  payment_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency in ('EUR', 'CHF')),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  constraint invoice_payments_invoice_fk foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete cascade,
  constraint invoice_payments_income_fk foreign key (income_id, user_id) references public.incomes (id, user_id) on delete set null,
  constraint invoice_payments_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade
);

alter table public.incomes add constraint incomes_invoice_fk foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete set null;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_settings invoice_settings%rowtype;
  v_year integer;
  v_number integer;
  v_invoice_number text;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Rechnung wurde nicht gefunden.';
  end if;

  if v_invoice.status <> 'Entwurf' then
    return v_invoice.invoice_number;
  end if;

  if v_invoice.gross_total_cents <= 0 then
    raise exception 'Rechnung hat keinen gueltigen Betrag.';
  end if;

  select * into v_settings
  from public.invoice_settings
  where buchhaltung_id = v_invoice.buchhaltung_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Rechnungseinstellungen fehlen.';
  end if;

  v_year := extract(year from v_invoice.issue_date)::integer;
  if v_settings.yearly_reset and coalesce(v_settings.last_invoice_year, v_year) <> v_year then
    v_number := 1;
  else
    v_number := v_settings.next_invoice_number;
  end if;

  v_invoice_number := v_settings.invoice_prefix || '-' || v_year || '-' || lpad(v_number::text, 3, '0');

  update public.invoice_settings
  set next_invoice_number = v_number + 1,
      last_invoice_year = v_year
  where id = v_settings.id;

  update public.invoices
  set invoice_number = v_invoice_number,
      status = 'Ausgestellt',
      issued_at = now()
  where id = p_invoice_id and user_id = auth.uid();

  return v_invoice_number;
end;
$$;

create index if not exists idx_customers_buchhaltung_id on public.customers (buchhaltung_id);
create index if not exists idx_invoices_buchhaltung_id on public.invoices (buchhaltung_id);
create index if not exists idx_invoices_status on public.invoices (status);
create index if not exists idx_invoices_due_date on public.invoices (due_date);
create index if not exists idx_invoice_items_invoice_id on public.invoice_items (invoice_id);
create index if not exists idx_invoice_payments_invoice_id on public.invoice_payments (invoice_id);
create index if not exists idx_bank_accounts_buchhaltung_id on public.bank_accounts (buchhaltung_id);
create index if not exists idx_incomes_invoice_id on public.incomes (invoice_id);

drop trigger if exists set_updated_at_customers on public.customers;
create trigger set_updated_at_customers before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_invoice_settings on public.invoice_settings;
create trigger set_updated_at_invoice_settings before update on public.invoice_settings for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_bank_accounts on public.bank_accounts;
create trigger set_updated_at_bank_accounts before update on public.bank_accounts for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_invoices on public.invoices;
create trigger set_updated_at_invoices before update on public.invoices for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.invoice_settings enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_payments enable row level security;

drop policy if exists customers_own on public.customers;
create policy customers_own on public.customers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists invoice_settings_own on public.invoice_settings;
create policy invoice_settings_own on public.invoice_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists bank_accounts_own on public.bank_accounts;
create policy bank_accounts_own on public.bank_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists invoices_own on public.invoices;
create policy invoices_own on public.invoices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists invoice_items_own on public.invoice_items;
create policy invoice_items_own on public.invoice_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists invoice_payments_own on public.invoice_payments;
create policy invoice_payments_own on public.invoice_payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('invoice-assets', 'invoice-assets', false)
on conflict (id) do update set public = false;

drop policy if exists invoice_assets_storage_own on storage.objects;
create policy invoice_assets_storage_own on storage.objects
for all using (
  bucket_id = 'invoice-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
) with check (
  bucket_id = 'invoice-assets'
  and auth.uid()::text = (storage.foldername(name))[1]
);
