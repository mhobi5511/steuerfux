begin;

-- Wealth First is deliberately isolated from all accounting tables. This migration
-- only adds new objects; it neither rewrites nor backfills existing records.
create table if not exists public.wealth_first_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  current_buffer_cents bigint not null check (current_buffer_cents >= 0),
  warning_threshold_cents bigint not null check (warning_threshold_cents >= 0),
  version bigint not null default 1 check (version > 0),
  setup_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wealth_first_settings_book_fk foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen(id, user_id) on delete cascade,
  unique (buchhaltung_id, user_id),
  unique (id, user_id)
);

create table if not exists public.wealth_first_pots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  monthly_target_cents bigint not null check (monthly_target_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wealth_first_pots_book_fk foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen(id, user_id) on delete cascade,
  unique (id, user_id),
  unique (id, buchhaltung_id, user_id)
);

create table if not exists public.wealth_first_distributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  idempotency_key uuid not null,
  distribution_month date not null check (distribution_month = date_trunc('month', distribution_month)::date),
  confirmed_at timestamptz not null default now(),
  bank_balance_cents bigint not null check (bank_balance_cents >= 0),
  previous_buffer_cents bigint not null check (previous_buffer_cents >= 0),
  new_receipts_cents bigint not null check (new_receipts_cents >= 0),
  tax_rate_basis_points_snapshot integer not null check (tax_rate_basis_points_snapshot between 0 and 10000),
  tax_reserve_cents bigint not null check (tax_reserve_cents >= 0),
  available_funds_cents bigint not null check (available_funds_cents >= 0),
  allocation_total_cents bigint not null check (allocation_total_cents >= 0),
  buffer_change_cents bigint not null,
  resulting_buffer_cents bigint not null check (resulting_buffer_cents >= 0),
  warning_threshold_cents_snapshot bigint not null check (warning_threshold_cents_snapshot >= 0),
  settings_version_snapshot bigint not null check (settings_version_snapshot > 0),
  created_at timestamptz not null default now(),
  constraint wealth_first_distributions_book_fk foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen(id, user_id) on delete cascade,
  unique (user_id, idempotency_key),
  unique (id, user_id),
  unique (id, buchhaltung_id, user_id),
  check (new_receipts_cents = bank_balance_cents - previous_buffer_cents),
  check (available_funds_cents = new_receipts_cents - tax_reserve_cents),
  check (buffer_change_cents = available_funds_cents - allocation_total_cents),
  check (resulting_buffer_cents = previous_buffer_cents + buffer_change_cents),
  check (bank_balance_cents = tax_reserve_cents + allocation_total_cents + resulting_buffer_cents)
);

create table if not exists public.wealth_first_distribution_allocations (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null,
  pot_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  pot_name_snapshot text not null check (char_length(trim(pot_name_snapshot)) between 1 and 80),
  monthly_target_cents_snapshot bigint not null check (monthly_target_cents_snapshot >= 0),
  already_allocated_cents_snapshot bigint not null check (already_allocated_cents_snapshot >= 0),
  allocation_cents bigint not null check (allocation_cents >= 0),
  expected_month_total_cents bigint not null check (expected_month_total_cents >= 0),
  exceptional boolean not null default false,
  created_at timestamptz not null default now(),
  constraint wealth_first_allocations_distribution_fk
    foreign key (distribution_id, buchhaltung_id, user_id)
    references public.wealth_first_distributions(id, buchhaltung_id, user_id) on delete restrict,
  constraint wealth_first_allocations_pot_fk
    foreign key (pot_id, buchhaltung_id, user_id)
    references public.wealth_first_pots(id, buchhaltung_id, user_id) on delete restrict,
  unique (distribution_id, pot_id),
  check (expected_month_total_cents = already_allocated_cents_snapshot + allocation_cents)
);

create table if not exists public.wealth_first_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  idempotency_key uuid not null,
  reconciliation_type text not null check (reconciliation_type in ('withdrawal','refund','deposit','transfer','other')),
  previous_buffer_cents bigint not null check (previous_buffer_cents >= 0),
  actual_balance_cents bigint not null check (actual_balance_cents >= 0),
  adjustment_cents bigint not null,
  resulting_buffer_cents bigint not null check (resulting_buffer_cents >= 0),
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  confirmed_at timestamptz not null default now(),
  settings_version_snapshot bigint not null check (settings_version_snapshot > 0),
  created_at timestamptz not null default now(),
  constraint wealth_first_reconciliations_book_fk foreign key (buchhaltung_id, user_id)
    references public.buchhaltungen(id, user_id) on delete cascade,
  unique (user_id, idempotency_key),
  check (adjustment_cents = actual_balance_cents - previous_buffer_cents),
  check (resulting_buffer_cents = actual_balance_cents)
);

create index if not exists wealth_first_distributions_month_idx
  on public.wealth_first_distributions(user_id, buchhaltung_id, distribution_month, confirmed_at);
create index if not exists wealth_first_allocations_month_lookup_idx
  on public.wealth_first_distribution_allocations(user_id, buchhaltung_id, pot_id, distribution_id);
create index if not exists wealth_first_pots_active_idx
  on public.wealth_first_pots(user_id, buchhaltung_id, active, sort_order);

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.wealth_first_settings'::regclass and tgname = 'set_updated_at_wealth_first_settings') then
    create trigger set_updated_at_wealth_first_settings before update on public.wealth_first_settings
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.wealth_first_pots'::regclass and tgname = 'set_updated_at_wealth_first_pots') then
    create trigger set_updated_at_wealth_first_pots before update on public.wealth_first_pots
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.wealth_first_settings enable row level security;
alter table public.wealth_first_pots enable row level security;
alter table public.wealth_first_distributions enable row level security;
alter table public.wealth_first_distribution_allocations enable row level security;
alter table public.wealth_first_reconciliations enable row level security;

do $$
declare t text; policy_name text;
begin
  foreach t in array array[
    'wealth_first_settings', 'wealth_first_pots', 'wealth_first_distributions',
    'wealth_first_distribution_allocations', 'wealth_first_reconciliations'
  ] loop
    policy_name := t || '_select_own';
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = policy_name) then
      execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', policy_name, t);
    end if;
  end loop;
end $$;

revoke insert, update, delete on public.wealth_first_settings from authenticated;
revoke insert, update, delete on public.wealth_first_pots from authenticated;
revoke insert, update, delete on public.wealth_first_distributions from authenticated;
revoke insert, update, delete on public.wealth_first_distribution_allocations from authenticated;
revoke insert, update, delete on public.wealth_first_reconciliations from authenticated;
grant select on public.wealth_first_settings, public.wealth_first_pots,
  public.wealth_first_distributions, public.wealth_first_distribution_allocations,
  public.wealth_first_reconciliations to authenticated;

create or replace function public.guard_wealth_first_history()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Abgeschlossene Wealth-First-Einträge sind unveränderlich.';
end;
$$;

do $$
declare t text; trigger_name text;
begin
  foreach t in array array['wealth_first_distributions','wealth_first_distribution_allocations','wealth_first_reconciliations'] loop
    trigger_name := 'guard_' || t || '_history';
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = trigger_name) then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.guard_wealth_first_history()', trigger_name, t);
    end if;
  end loop;
end $$;

create or replace function public.save_wealth_first_settings_v1(
  p_buchhaltung_id uuid,
  p_expected_version bigint,
  p_tax_rate_basis_points integer,
  p_warning_threshold_cents bigint,
  p_initial_buffer_cents bigint,
  p_pots jsonb
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.wealth_first_settings%rowtype;
  item jsonb;
  pot_uuid uuid;
  next_version bigint;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich.'; end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid()
    and country = 'Schweiz' and reporting_currency = 'CHF' and status = 'aktiv' for share;
  if not found then raise exception 'Wealth First ist nur für die aktive Schweizer CHF-Buchhaltung verfügbar.'; end if;
  if p_tax_rate_basis_points is null or p_tax_rate_basis_points < 0 or p_tax_rate_basis_points > 10000
    or p_warning_threshold_cents is null or p_warning_threshold_cents < 0
    or jsonb_typeof(p_pots) is distinct from 'array' or jsonb_array_length(p_pots) < 1 or jsonb_array_length(p_pots) > 50
  then raise exception 'Einstellungen oder Spartöpfe sind ungültig.'; end if;

  select * into s from public.wealth_first_settings
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then
    if p_expected_version is not null or p_initial_buffer_cents is null or p_initial_buffer_cents < 0 then
      raise exception 'Für die Ersteinrichtung ist ein gültiger Business-Puffer erforderlich.';
    end if;
    insert into public.wealth_first_settings(user_id, buchhaltung_id, tax_rate_basis_points,
      current_buffer_cents, warning_threshold_cents, version)
    values(auth.uid(), p_buchhaltung_id, p_tax_rate_basis_points, p_initial_buffer_cents,
      p_warning_threshold_cents, 1) returning * into s;
    next_version := 1;
  else
    if p_expected_version is null or s.version <> p_expected_version then
      raise exception 'Die Einstellungen wurden zwischenzeitlich geändert. Bitte neu laden.';
    end if;
    -- The saved buffer is intentionally not accepted from the settings editor.
    update public.wealth_first_settings set tax_rate_basis_points = p_tax_rate_basis_points,
      warning_threshold_cents = p_warning_threshold_cents, version = version + 1
      where id = s.id returning version into next_version;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_pots) a
    where nullif(trim(a->>'name'), '') is null or char_length(trim(a->>'name')) > 80
      or (a->>'monthly_target_cents') is null
      or (a->>'monthly_target_cents')::numeric < 0
      or (a->>'monthly_target_cents')::numeric > 90000000000000
      or (a->>'monthly_target_cents')::numeric <> trunc((a->>'monthly_target_cents')::numeric)
  ) or (select count(*) from jsonb_array_elements(p_pots)) <>
       (select count(distinct a->>'id') from jsonb_array_elements(p_pots) a)
  then raise exception 'Spartopf-Daten sind ungültig oder doppelt.'; end if;

  for item in select value from jsonb_array_elements(p_pots) loop
    pot_uuid := (item->>'id')::uuid;
    if exists (select 1 from public.wealth_first_pots where id = pot_uuid) then
      update public.wealth_first_pots set name = trim(item->>'name'),
        monthly_target_cents = (item->>'monthly_target_cents')::bigint,
        active = coalesce((item->>'active')::boolean, true),
        sort_order = coalesce((item->>'sort_order')::integer, 0)
      where id = pot_uuid and user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id;
      if not found then raise exception 'Ein Spartopf gehört nicht zu dieser Buchhaltung.'; end if;
    else
      insert into public.wealth_first_pots(id, user_id, buchhaltung_id, name,
        monthly_target_cents, active, sort_order)
      values(pot_uuid, auth.uid(), p_buchhaltung_id, trim(item->>'name'),
        (item->>'monthly_target_cents')::bigint,
        coalesce((item->>'active')::boolean, true), coalesce((item->>'sort_order')::integer, 0));
    end if;
  end loop;
  update public.wealth_first_pots set active = false
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id
      and not (id = any(array(select (a->>'id')::uuid from jsonb_array_elements(p_pots) a)));
  return next_version;
end;
$$;

create or replace function public.reconcile_wealth_first_buffer_v1(
  p_buchhaltung_id uuid,
  p_idempotency_key uuid,
  p_expected_version bigint,
  p_expected_buffer_cents bigint,
  p_actual_balance_cents bigint,
  p_reconciliation_type text,
  p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.wealth_first_settings%rowtype;
  previous public.wealth_first_reconciliations%rowtype;
  reconciliation_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or p_idempotency_key is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  select * into s from public.wealth_first_settings
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then raise exception 'Wealth First muss zuerst eingerichtet werden.'; end if;
  select * into previous from public.wealth_first_reconciliations
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    if previous.buchhaltung_id is distinct from p_buchhaltung_id
      or previous.previous_buffer_cents is distinct from p_expected_buffer_cents
      or previous.actual_balance_cents is distinct from p_actual_balance_cents
      or previous.reconciliation_type is distinct from p_reconciliation_type
      or previous.reason is distinct from trim(p_reason)
    then raise exception 'Dieser Anfrage-Schlüssel gehört zu einer anderen Abstimmung.'; end if;
    return previous.id;
  end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid()
    and country = 'Schweiz' and reporting_currency = 'CHF' and status = 'aktiv' for share;
  if not found then raise exception 'Wealth First ist nur für die aktive Schweizer CHF-Buchhaltung verfügbar.'; end if;
  if s.version is distinct from p_expected_version or s.current_buffer_cents is distinct from p_expected_buffer_cents then
    raise exception 'Der Business-Puffer wurde zwischenzeitlich geändert. Bitte neu berechnen.';
  end if;
  if p_actual_balance_cents is null or p_actual_balance_cents < 0
    or p_reconciliation_type not in ('withdrawal','refund','deposit','transfer','other')
    or char_length(trim(coalesce(p_reason, ''))) not between 5 and 500
  then raise exception 'Abstimmungstyp, Kontostand oder Begründung ist ungültig.'; end if;
  insert into public.wealth_first_reconciliations(id, user_id, buchhaltung_id, idempotency_key,
    reconciliation_type, previous_buffer_cents, actual_balance_cents, adjustment_cents,
    resulting_buffer_cents, reason, settings_version_snapshot)
  values(reconciliation_id, auth.uid(), p_buchhaltung_id, p_idempotency_key,
    p_reconciliation_type, s.current_buffer_cents, p_actual_balance_cents,
    p_actual_balance_cents - s.current_buffer_cents, p_actual_balance_cents,
    trim(p_reason), s.version);
  update public.wealth_first_settings set current_buffer_cents = p_actual_balance_cents,
    version = version + 1 where id = s.id;
  return reconciliation_id;
end;
$$;

create or replace function public.confirm_wealth_first_distribution_v1(
  p_buchhaltung_id uuid,
  p_idempotency_key uuid,
  p_distribution_month date,
  p_bank_balance_cents bigint,
  p_expected_buffer_cents bigint,
  p_expected_settings_version bigint,
  p_allocations jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.wealth_first_settings%rowtype;
  previous public.wealth_first_distributions%rowtype;
  v_distribution_id uuid := gen_random_uuid();
  item jsonb;
  pot public.wealth_first_pots%rowtype;
  already bigint;
  amount bigint;
  target_remaining bigint;
  allocation_total bigint := 0;
  new_receipts bigint;
  tax_reserve bigint;
  available_funds bigint;
  resulting_buffer bigint;
begin
  if auth.uid() is null or p_idempotency_key is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  select * into s from public.wealth_first_settings
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then raise exception 'Wealth First muss zuerst eingerichtet werden.'; end if;
  select * into previous from public.wealth_first_distributions
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    if previous.buchhaltung_id is distinct from p_buchhaltung_id
      or previous.distribution_month is distinct from p_distribution_month
      or previous.bank_balance_cents is distinct from p_bank_balance_cents
      or previous.previous_buffer_cents is distinct from p_expected_buffer_cents
      or previous.settings_version_snapshot is distinct from p_expected_settings_version
      or (select count(*) from public.wealth_first_distribution_allocations a where a.distribution_id = previous.id)
         <> jsonb_array_length(p_allocations)
      or exists (select 1 from jsonb_array_elements(p_allocations) j where not exists (
        select 1 from public.wealth_first_distribution_allocations a
        where a.distribution_id = previous.id and a.pot_id = (j->>'pot_id')::uuid
          and a.allocation_cents = (j->>'allocation_cents')::bigint
          and a.exceptional = coalesce((j->>'exceptional')::boolean, false)))
    then raise exception 'Dieser Anfrage-Schlüssel gehört zu einer anderen Verteilung.'; end if;
    return previous.id;
  end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid()
    and country = 'Schweiz' and reporting_currency = 'CHF' and status = 'aktiv' for share;
  if not found then raise exception 'Wealth First ist nur für die aktive Schweizer CHF-Buchhaltung verfügbar.'; end if;
  if s.version is distinct from p_expected_settings_version
    or s.current_buffer_cents is distinct from p_expected_buffer_cents
  then raise exception 'Puffer oder Monatsziele wurden zwischenzeitlich geändert. Bitte neu berechnen.'; end if;
  if p_distribution_month is null or p_distribution_month <> date_trunc('month', p_distribution_month)::date
    or p_bank_balance_cents is null or p_bank_balance_cents < s.current_buffer_cents
    or jsonb_typeof(p_allocations) is distinct from 'array'
    or jsonb_array_length(p_allocations) <> (select count(*) from public.wealth_first_pots where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active)
    or (select count(*) from jsonb_array_elements(p_allocations)) <>
       (select count(distinct j->>'pot_id') from jsonb_array_elements(p_allocations) j)
  then raise exception 'Die Verteilung ist nicht vollständig oder der Kontostand muss zuerst abgestimmt werden.'; end if;

  for item in select value from jsonb_array_elements(p_allocations) loop
    select * into pot from public.wealth_first_pots where id = (item->>'pot_id')::uuid
      and user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active for share;
    if not found then raise exception 'Ein Spartopf ist nicht mehr aktiv. Bitte neu berechnen.'; end if;
    amount := (item->>'allocation_cents')::bigint;
    if amount is null or amount < 0 then raise exception 'Zuweisungen dürfen nicht negativ sein.'; end if;
    select coalesce(sum(a.allocation_cents), 0) into already
      from public.wealth_first_distribution_allocations a
      join public.wealth_first_distributions d on d.id = a.distribution_id
      where a.user_id = auth.uid() and a.buchhaltung_id = p_buchhaltung_id
        and a.pot_id = pot.id and d.distribution_month = p_distribution_month;
    target_remaining := greatest(0, pot.monthly_target_cents - already);
    if amount > target_remaining and not coalesce((item->>'exceptional')::boolean, false) then
      raise exception 'Eine Zuweisung überschreitet das offene Monatsziel und wurde nicht als Ausnahme bestätigt.';
    end if;
    allocation_total := allocation_total + amount;
  end loop;

  new_receipts := p_bank_balance_cents - s.current_buffer_cents;
  tax_reserve := round(new_receipts::numeric * s.tax_rate_basis_points / 10000)::bigint;
  available_funds := new_receipts - tax_reserve;
  resulting_buffer := s.current_buffer_cents + available_funds - allocation_total;
  if resulting_buffer < 0 then raise exception 'Die geplanten Zuweisungen übersteigen die verfügbaren Mittel.'; end if;
  if p_bank_balance_cents <> tax_reserve + allocation_total + resulting_buffer then
    raise exception 'Die Verteilung stimmt nicht auf den Rappen genau.'; end if;

  insert into public.wealth_first_distributions(id, user_id, buchhaltung_id, idempotency_key,
    distribution_month, bank_balance_cents, previous_buffer_cents, new_receipts_cents,
    tax_rate_basis_points_snapshot, tax_reserve_cents, available_funds_cents,
    allocation_total_cents, buffer_change_cents, resulting_buffer_cents,
    warning_threshold_cents_snapshot, settings_version_snapshot)
  values(v_distribution_id, auth.uid(), p_buchhaltung_id, p_idempotency_key,
    p_distribution_month, p_bank_balance_cents, s.current_buffer_cents, new_receipts,
    s.tax_rate_basis_points, tax_reserve, available_funds, allocation_total,
    available_funds - allocation_total, resulting_buffer, s.warning_threshold_cents, s.version);

  for item in select value from jsonb_array_elements(p_allocations) loop
    select * into pot from public.wealth_first_pots where id = (item->>'pot_id')::uuid;
    select coalesce(sum(a.allocation_cents), 0) into already
      from public.wealth_first_distribution_allocations a
      join public.wealth_first_distributions d on d.id = a.distribution_id
      where a.user_id = auth.uid() and a.buchhaltung_id = p_buchhaltung_id
        and a.pot_id = pot.id and d.distribution_month = p_distribution_month
        and d.id <> v_distribution_id;
    amount := (item->>'allocation_cents')::bigint;
    insert into public.wealth_first_distribution_allocations(distribution_id, pot_id,
      user_id, buchhaltung_id, pot_name_snapshot, monthly_target_cents_snapshot,
      already_allocated_cents_snapshot, allocation_cents, expected_month_total_cents, exceptional)
    values(v_distribution_id, pot.id, auth.uid(), p_buchhaltung_id, pot.name,
      pot.monthly_target_cents, already, amount, already + amount,
      coalesce((item->>'exceptional')::boolean, false));
  end loop;
  update public.wealth_first_settings set current_buffer_cents = resulting_buffer,
    version = version + 1 where id = s.id;
  return v_distribution_id;
end;
$$;

revoke all on function public.save_wealth_first_settings_v1(uuid,bigint,integer,bigint,bigint,jsonb) from public;
revoke all on function public.reconcile_wealth_first_buffer_v1(uuid,uuid,bigint,bigint,bigint,text,text) from public;
revoke all on function public.confirm_wealth_first_distribution_v1(uuid,uuid,date,bigint,bigint,bigint,jsonb) from public;
grant execute on function public.save_wealth_first_settings_v1(uuid,bigint,integer,bigint,bigint,jsonb) to authenticated;
grant execute on function public.reconcile_wealth_first_buffer_v1(uuid,uuid,bigint,bigint,bigint,text,text) to authenticated;
grant execute on function public.confirm_wealth_first_distribution_v1(uuid,uuid,date,bigint,bigint,bigint,jsonb) to authenticated;

commit;
