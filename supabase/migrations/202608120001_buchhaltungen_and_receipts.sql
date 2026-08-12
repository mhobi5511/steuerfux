create table if not exists public.buchhaltungen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  country text not null check (country in ('Deutschland', 'Schweiz')),
  reporting_currency text not null check (reporting_currency in ('EUR', 'CHF')),
  start_date date not null,
  end_date date,
  status text not null default 'aktiv' check (status in ('aktiv', 'abgeschlossen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  unique (id, user_id)
);

insert into public.buchhaltungen (
  user_id,
  name,
  country,
  reporting_currency,
  start_date,
  status
)
select
  s.user_id,
  coalesce(nullif('Buchhaltung ' || coalesce(s.business_owner_name, ''), 'Buchhaltung '), 'Meine Buchhaltung'),
  s.business_country,
  s.reporting_currency,
  make_date(s.business_year, 1, 1),
  'aktiv'
from public.settings s
where not exists (
  select 1 from public.buchhaltungen b where b.user_id = s.user_id
);

alter table public.incomes add column if not exists buchhaltung_id uuid;
alter table public.expenses add column if not exists buchhaltung_id uuid;
alter table public.bank_fees add column if not exists buchhaltung_id uuid;
alter table public.reimbursements add column if not exists buchhaltung_id uuid;
alter table public.trips add column if not exists buchhaltung_id uuid;
alter table public.trip_stops add column if not exists buchhaltung_id uuid;
alter table public.trip_segments add column if not exists buchhaltung_id uuid;
alter table public.depreciations add column if not exists buchhaltung_id uuid;

update public.incomes r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.expenses r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.bank_fees r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.reimbursements r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.trips r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.depreciations r set buchhaltung_id = b.id
from public.buchhaltungen b
where r.buchhaltung_id is null and r.user_id = b.user_id;
update public.trip_stops s set buchhaltung_id = t.buchhaltung_id
from public.trips t
where s.buchhaltung_id is null and s.trip_id = t.id and s.user_id = t.user_id;
update public.trip_segments s set buchhaltung_id = t.buchhaltung_id
from public.trips t
where s.buchhaltung_id is null and s.trip_id = t.id and s.user_id = t.user_id;

alter table public.incomes alter column buchhaltung_id set not null;
alter table public.expenses alter column buchhaltung_id set not null;
alter table public.bank_fees alter column buchhaltung_id set not null;
alter table public.reimbursements alter column buchhaltung_id set not null;
alter table public.trips alter column buchhaltung_id set not null;
alter table public.trip_stops alter column buchhaltung_id set not null;
alter table public.trip_segments alter column buchhaltung_id set not null;
alter table public.depreciations alter column buchhaltung_id set not null;

alter table public.incomes add constraint incomes_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.expenses add constraint expenses_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.bank_fees add constraint bank_fees_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.reimbursements add constraint reimbursements_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.trips add constraint trips_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.trip_stops add constraint trip_stops_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.trip_segments add constraint trip_segments_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;
alter table public.depreciations add constraint depreciations_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  expense_id uuid not null,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0),
  created_at timestamptz not null default now(),
  constraint receipts_buchhaltung_fk foreign key (buchhaltung_id, user_id) references public.buchhaltungen (id, user_id) on delete cascade,
  constraint receipts_expense_fk foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete cascade
);

create index if not exists idx_buchhaltungen_user_id on public.buchhaltungen (user_id);
create index if not exists idx_buchhaltungen_user_status on public.buchhaltungen (user_id, status);
create index if not exists idx_incomes_buchhaltung_id on public.incomes (buchhaltung_id);
create index if not exists idx_expenses_buchhaltung_id on public.expenses (buchhaltung_id);
create index if not exists idx_bank_fees_buchhaltung_id on public.bank_fees (buchhaltung_id);
create index if not exists idx_reimbursements_buchhaltung_id on public.reimbursements (buchhaltung_id);
create index if not exists idx_trips_buchhaltung_id on public.trips (buchhaltung_id);
create index if not exists idx_trip_stops_buchhaltung_id on public.trip_stops (buchhaltung_id);
create index if not exists idx_trip_segments_buchhaltung_id on public.trip_segments (buchhaltung_id);
create index if not exists idx_depreciations_buchhaltung_id on public.depreciations (buchhaltung_id);
create index if not exists idx_receipts_user_id on public.receipts (user_id);
create index if not exists idx_receipts_buchhaltung_id on public.receipts (buchhaltung_id);
create index if not exists idx_receipts_expense_id on public.receipts (expense_id);

drop trigger if exists set_updated_at_buchhaltungen on public.buchhaltungen;
create trigger set_updated_at_buchhaltungen before update on public.buchhaltungen for each row execute function public.set_updated_at();

alter table public.buchhaltungen enable row level security;
alter table public.receipts enable row level security;

drop policy if exists buchhaltungen_select_own on public.buchhaltungen;
create policy buchhaltungen_select_own on public.buchhaltungen for select using (auth.uid() = user_id);
drop policy if exists buchhaltungen_insert_own on public.buchhaltungen;
create policy buchhaltungen_insert_own on public.buchhaltungen for insert with check (auth.uid() = user_id);
drop policy if exists buchhaltungen_update_own on public.buchhaltungen;
create policy buchhaltungen_update_own on public.buchhaltungen for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists buchhaltungen_delete_own on public.buchhaltungen;
create policy buchhaltungen_delete_own on public.buchhaltungen for delete using (auth.uid() = user_id);

drop policy if exists receipts_select_own on public.receipts;
create policy receipts_select_own on public.receipts for select using (auth.uid() = user_id);
drop policy if exists receipts_insert_own on public.receipts;
create policy receipts_insert_own on public.receipts for insert with check (auth.uid() = user_id);
drop policy if exists receipts_update_own on public.receipts;
create policy receipts_update_own on public.receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists receipts_delete_own on public.receipts;
create policy receipts_delete_own on public.receipts for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

drop policy if exists receipts_storage_select_own on storage.objects;
create policy receipts_storage_select_own on storage.objects
for select using (
  bucket_id = 'receipts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists receipts_storage_insert_own on storage.objects;
create policy receipts_storage_insert_own on storage.objects
for insert with check (
  bucket_id = 'receipts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists receipts_storage_update_own on storage.objects;
create policy receipts_storage_update_own on storage.objects
for update using (
  bucket_id = 'receipts'
  and auth.uid()::text = (storage.foldername(name))[1]
) with check (
  bucket_id = 'receipts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists receipts_storage_delete_own on storage.objects;
create policy receipts_storage_delete_own on storage.objects
for delete using (
  bucket_id = 'receipts'
  and auth.uid()::text = (storage.foldername(name))[1]
);
