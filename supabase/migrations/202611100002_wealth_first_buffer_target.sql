begin;

-- Run manually AFTER 202611100001_wealth_first_service_dates.sql.
-- No DML/backfill: existing financial values and immutable history remain unchanged.
-- warning_threshold_cents is reused as the configurable buffer target going forward.
alter table public.wealth_first_settings add column if not exists pending_surplus_cents bigint
  check (pending_surplus_cents >= 0);
alter table public.wealth_first_distributions
  add column if not exists buffer_target_cents_snapshot bigint check (buffer_target_cents_snapshot >= 0),
  add column if not exists previous_pending_surplus_cents_snapshot bigint check (previous_pending_surplus_cents_snapshot >= 0),
  add column if not exists investment_surplus_cents bigint check (investment_surplus_cents >= 0),
  add column if not exists surplus_transfer_cents bigint check (surplus_transfer_cents >= 0),
  add column if not exists pending_surplus_cents bigint check (pending_surplus_cents >= 0),
  add column if not exists surplus_transfer_confirmed_snapshot boolean,
  add column if not exists excess_buffer_release_confirmed_snapshot boolean;

-- Three existing equations assume that every retained centime is reserved buffer.
-- Extend only those equations, atomically under the ALTER TABLE lock. For old rows
-- all added fields are NULL, so the equations are EXACTLY the original equations.
-- No table/column, ownership constraint, unique key or nonnegative guard is removed.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.wealth_first_distributions'::regclass
    and conname = 'wealth_first_distribution_surplus_invariants') then
    alter table public.wealth_first_distributions
      drop constraint wealth_first_distributions_check,
      drop constraint wealth_first_distributions_check2,
      drop constraint wealth_first_distributions_check4,
      add constraint wealth_first_distributions_check check (
        new_receipts_cents = bank_balance_cents - previous_buffer_cents - coalesce(previous_pending_surplus_cents_snapshot, 0)),
      add constraint wealth_first_distributions_check2 check (
        buffer_change_cents = available_funds_cents - allocation_total_cents - coalesce(investment_surplus_cents, 0)),
      add constraint wealth_first_distributions_check4 check (
        bank_balance_cents = tax_reserve_cents + allocation_total_cents + resulting_buffer_cents
          + coalesce(surplus_transfer_cents, 0) + coalesce(pending_surplus_cents, 0)),
      add constraint wealth_first_distribution_surplus_invariants check (
        (buffer_target_cents_snapshot is null and previous_pending_surplus_cents_snapshot is null
          and investment_surplus_cents is null and surplus_transfer_cents is null and pending_surplus_cents is null
          and surplus_transfer_confirmed_snapshot is null and excess_buffer_release_confirmed_snapshot is null)
        or (buffer_target_cents_snapshot is not null and previous_pending_surplus_cents_snapshot is not null
          and investment_surplus_cents is not null and surplus_transfer_cents is not null and pending_surplus_cents is not null
          and surplus_transfer_confirmed_snapshot is not null and excess_buffer_release_confirmed_snapshot is not null
          and resulting_buffer_cents = least(buffer_target_cents_snapshot, previous_buffer_cents + available_funds_cents - allocation_total_cents)
          and investment_surplus_cents = greatest(0, previous_buffer_cents + available_funds_cents - allocation_total_cents - buffer_target_cents_snapshot)
          and pending_surplus_cents = previous_pending_surplus_cents_snapshot + investment_surplus_cents - surplus_transfer_cents
          and surplus_transfer_cents = case when surplus_transfer_confirmed_snapshot
            then previous_pending_surplus_cents_snapshot + investment_surplus_cents else 0 end
          and (previous_buffer_cents <= buffer_target_cents_snapshot or investment_surplus_cents = 0
            or excess_buffer_release_confirmed_snapshot))
      );
  end if;
end $$;

-- Later user confirmations are append-only events, never edits of a distribution.
create table if not exists public.wealth_first_surplus_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buchhaltung_id uuid not null,
  idempotency_key uuid not null,
  settlement_date date not null check (isfinite(settlement_date) and settlement_date between date '0001-01-01' and date '9999-12-31'),
  settlement_type text not null check (settlement_type in ('transfer', 'reconciliation')),
  amount_cents bigint not null check (amount_cents > 0),
  previous_pending_cents bigint not null check (previous_pending_cents >= 0),
  resulting_pending_cents bigint not null check (resulting_pending_cents >= 0),
  buffer_cents_snapshot bigint not null check (buffer_cents_snapshot >= 0),
  settings_version_snapshot bigint not null check (settings_version_snapshot > 0),
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  created_at timestamptz not null default now(),
  foreign key (buchhaltung_id, user_id) references public.buchhaltungen(id, user_id) on delete restrict,
  unique (user_id, idempotency_key),
  check (resulting_pending_cents = previous_pending_cents - amount_cents)
);
create index if not exists wealth_first_surplus_settlements_book_idx
  on public.wealth_first_surplus_settlements(user_id, buchhaltung_id, settlement_date);
alter table public.wealth_first_surplus_settlements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wealth_first_surplus_settlements'
    and policyname = 'wealth_first_surplus_settlements_select_own') then
    create policy wealth_first_surplus_settlements_select_own on public.wealth_first_surplus_settlements
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.wealth_first_surplus_settlements'::regclass
    and tgname = 'guard_wealth_first_surplus_settlements_history') then
    create trigger guard_wealth_first_surplus_settlements_history before update or delete
      on public.wealth_first_surplus_settlements for each row execute function public.guard_wealth_first_history();
  end if;
end $$;
revoke all on public.wealth_first_surplus_settlements from public, anon, authenticated;
grant select on public.wealth_first_surplus_settlements to authenticated;

-- The old bank reconciliation treats the complete bank balance as reserved buffer.
-- Prevent it from swallowing outstanding surplus; settle/correct surplus explicitly first.
create or replace function public.guard_wealth_first_pending_reconciliation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.wealth_first_settings s where s.user_id = new.user_id
    and s.buchhaltung_id = new.buchhaltung_id and coalesce(s.pending_surplus_cents, 0) > 0) then
    raise exception 'Bitte den offenen Überschuss zuerst separat als überwiesen bestätigen oder seinen Abgang abstimmen. Er darf nicht zum Business-Puffer werden.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_wealth_first_pending_reconciliation() from public;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.wealth_first_reconciliations'::regclass
    and tgname = 'guard_wealth_first_pending_reconciliation') then
    create trigger guard_wealth_first_pending_reconciliation before insert on public.wealth_first_reconciliations
      for each row execute function public.guard_wealth_first_pending_reconciliation();
  end if;
end $$;

create or replace function public.settle_wealth_first_surplus_v1(
  p_buchhaltung_id uuid, p_idempotency_key uuid, p_expected_version bigint,
  p_expected_pending_cents bigint, p_amount_cents bigint, p_settlement_date date,
  p_settlement_type text, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.wealth_first_settings%rowtype;
  previous public.wealth_first_surplus_settlements%rowtype;
  event_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or p_idempotency_key is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  select * into s from public.wealth_first_settings
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then raise exception 'Wealth First muss zuerst eingerichtet werden.'; end if;
  select * into previous from public.wealth_first_surplus_settlements
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    if previous.buchhaltung_id is distinct from p_buchhaltung_id
      or previous.previous_pending_cents is distinct from p_expected_pending_cents
      or previous.settings_version_snapshot is distinct from p_expected_version
      or previous.amount_cents is distinct from p_amount_cents
      or previous.settlement_date is distinct from p_settlement_date
      or previous.settlement_type is distinct from p_settlement_type
      or previous.reason is distinct from trim(p_reason)
    then raise exception 'Dieser Anfrage-Schlüssel gehört zu einer anderen Überschuss-Abstimmung.'; end if;
    return previous.id;
  end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid()
    and country = 'Schweiz' and reporting_currency = 'CHF' and status = 'aktiv' for share;
  if not found then raise exception 'Wealth First ist nur für die aktive Schweizer CHF-Buchhaltung verfügbar.'; end if;
  if s.version is distinct from p_expected_version or coalesce(s.pending_surplus_cents, 0) is distinct from p_expected_pending_cents then
    raise exception 'Puffer oder offener Überschuss wurden zwischenzeitlich geändert. Bitte neu laden.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > coalesce(s.pending_surplus_cents, 0)
    or p_settlement_type is null or p_settlement_type not in ('transfer', 'reconciliation')
    or p_settlement_date is null or not isfinite(p_settlement_date)
    or p_settlement_date not between date '0001-01-01' and date '9999-12-31'
    or char_length(trim(coalesce(p_reason, ''))) not between 5 and 500
  then raise exception 'Betrag, Datum, Art oder Begründung der Überschuss-Abstimmung ist ungültig.'; end if;
  if exists (select 1 from public.wealth_first_distributions d where d.user_id = auth.uid() and d.buchhaltung_id = p_buchhaltung_id
      and coalesce(d.distribution_date, (d.confirmed_at at time zone 'Europe/Zurich')::date) > p_settlement_date)
    or exists (select 1 from public.wealth_first_reconciliations r where r.user_id = auth.uid() and r.buchhaltung_id = p_buchhaltung_id
      and (r.confirmed_at at time zone 'Europe/Zurich')::date > p_settlement_date)
    or exists (select 1 from public.wealth_first_surplus_settlements e where e.user_id = auth.uid()
      and e.buchhaltung_id = p_buchhaltung_id and e.settlement_date > p_settlement_date)
  then raise exception 'Das Datum liegt vor einer gespeicherten Verteilung oder Abstimmung. Bitte einen separaten Korrekturablauf verwenden.'; end if;
  insert into public.wealth_first_surplus_settlements(id, user_id, buchhaltung_id, idempotency_key,
    settlement_date, settlement_type, amount_cents, previous_pending_cents, resulting_pending_cents,
    buffer_cents_snapshot, settings_version_snapshot, reason)
  values(event_id, auth.uid(), p_buchhaltung_id, p_idempotency_key, p_settlement_date, p_settlement_type,
    p_amount_cents, coalesce(s.pending_surplus_cents, 0), coalesce(s.pending_surplus_cents, 0) - p_amount_cents,
    s.current_buffer_cents, s.version, trim(p_reason));
  update public.wealth_first_settings set pending_surplus_cents = coalesce(pending_surplus_cents, 0) - p_amount_cents,
    version = version + 1 where id = s.id;
  return event_id;
end;
$$;
revoke all on function public.settle_wealth_first_surplus_v1(uuid,uuid,bigint,bigint,bigint,date,text,text) from public;
grant execute on function public.settle_wealth_first_surplus_v1(uuid,uuid,bigint,bigint,bigint,date,text,text) to authenticated;

-- Existing confirmation RPC, same signature. JSON accepts the legacy allocations array
-- or {allocations: [...], surplus_transfer_confirmed: bool, excess_buffer_release_confirmed: bool}.

create or replace function public.confirm_wealth_first_distribution_v2(
  p_buchhaltung_id uuid,
  p_idempotency_key uuid,
  p_distribution_month date,
  p_distribution_date date,
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
  remaining_money bigint;
  proposed bigint;
  v_allocations jsonb;
  previous_pending bigint;
  investment_surplus bigint;
  total_surplus bigint;
  surplus_transfer bigint;
  pending_surplus bigint;
  transfer_confirmed boolean;
  excess_release_confirmed boolean;
  target_aware boolean;
begin
  if auth.uid() is null or p_idempotency_key is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  target_aware := jsonb_typeof(p_allocations) = 'object';
  v_allocations := case when target_aware then p_allocations->'allocations' else p_allocations end;
  transfer_confirmed := coalesce((p_allocations->>'surplus_transfer_confirmed')::boolean, false);
  excess_release_confirmed := coalesce((p_allocations->>'excess_buffer_release_confirmed')::boolean, false);
  if jsonb_typeof(v_allocations) is distinct from 'array' then
    raise exception 'Die Zuweisungen müssen als vollständige Liste vorliegen.';
  end if;
  if jsonb_array_length(v_allocations) not between 1 and 50
    or (select count(*) from jsonb_array_elements(v_allocations)) <>
       (select count(distinct j->>'pot_id') from jsonb_array_elements(v_allocations) j)
    or exists (select 1 from jsonb_array_elements(v_allocations) j
      where (j->>'allocation_cents') is null
        or (j->>'allocation_cents')::numeric < 0
        or (j->>'allocation_cents')::numeric <> trunc((j->>'allocation_cents')::numeric))
  then raise exception 'Zuweisungen müssen eindeutig sein und in ganzen, nicht negativen Rappen vorliegen.'; end if;
  select * into s from public.wealth_first_settings
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then raise exception 'Wealth First muss zuerst eingerichtet werden.'; end if;
  select * into previous from public.wealth_first_distributions
    where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    if previous.buchhaltung_id is distinct from p_buchhaltung_id
      or previous.distribution_date is distinct from p_distribution_date
      or previous.distribution_month is distinct from p_distribution_month
      or previous.bank_balance_cents is distinct from p_bank_balance_cents
      or previous.previous_buffer_cents is distinct from p_expected_buffer_cents
      or previous.settings_version_snapshot is distinct from p_expected_settings_version
      or coalesce(previous.surplus_transfer_confirmed_snapshot, false) is distinct from transfer_confirmed
      or coalesce(previous.excess_buffer_release_confirmed_snapshot, false) is distinct from excess_release_confirmed
      or (select count(*) from public.wealth_first_distribution_allocations a where a.distribution_id = previous.id)
         <> jsonb_array_length(v_allocations)
      or exists (select 1 from jsonb_array_elements(v_allocations) j where not exists (
        select 1 from public.wealth_first_distribution_allocations a
        where a.distribution_id = previous.id and a.pot_id = (j->>'pot_id')::uuid
          and a.allocation_cents = (j->>'allocation_cents')::bigint
          and a.manual_override_snapshot = coalesce((j->>'manual_override')::boolean, false)))
    then raise exception 'Dieser Anfrage-Schlüssel gehört zu einer anderen Verteilung.'; end if;
    return previous.id;
  end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid()
    and country = 'Schweiz' and reporting_currency = 'CHF' and status = 'aktiv' for share;
  if not found then raise exception 'Wealth First ist nur für die aktive Schweizer CHF-Buchhaltung verfügbar.'; end if;
  if s.version is distinct from p_expected_settings_version
    or s.current_buffer_cents is distinct from p_expected_buffer_cents
  then raise exception 'Puffer oder Monatsziele wurden zwischenzeitlich geändert. Bitte neu berechnen.'; end if;
  previous_pending := coalesce(s.pending_surplus_cents, 0);
  if p_distribution_date is null or not isfinite(p_distribution_date)
    or p_distribution_date not between date '0001-01-01' and date '9999-12-31'
  then raise exception 'Ein gültiges Verteilungsdatum ist erforderlich.'; end if;
  if exists (select 1 from public.wealth_first_distributions d
    where d.user_id = auth.uid() and d.buchhaltung_id = p_buchhaltung_id
      and coalesce(d.distribution_date, (d.confirmed_at at time zone 'Europe/Zurich')::date) > p_distribution_date)
    or exists (select 1 from public.wealth_first_reconciliations r
      where r.user_id = auth.uid() and r.buchhaltung_id = p_buchhaltung_id
        and (r.confirmed_at at time zone 'Europe/Zurich')::date > p_distribution_date)
    or exists (select 1 from public.wealth_first_surplus_settlements e
      where e.user_id = auth.uid() and e.buchhaltung_id = p_buchhaltung_id and e.settlement_date > p_distribution_date)
  then raise exception 'Das Verteilungsdatum liegt vor einer gespeicherten Verteilung oder Puffer-Abstimmung. Eine rückwirkende Änderung benötigt einen separaten Korrekturablauf.'; end if;
  if not exists (select 1 from public.wealth_first_pots where user_id = auth.uid()
    and buchhaltung_id = p_buchhaltung_id and destination_type = 'service_account' and active)
  then raise exception 'Bitte das Servicekonto einmalig in den Einstellungen zuordnen und speichern.'; end if;
  if p_distribution_month is null or p_distribution_month <> date_trunc('month', p_distribution_month)::date
    or p_bank_balance_cents is null or p_bank_balance_cents < s.current_buffer_cents + previous_pending
    or jsonb_typeof(v_allocations) is distinct from 'array'
    or jsonb_array_length(v_allocations) <> (select count(*) from public.wealth_first_pots where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active)
    or (select count(*) from jsonb_array_elements(v_allocations)) <>
       (select count(distinct j->>'pot_id') from jsonb_array_elements(v_allocations) j)
  then raise exception 'Die Verteilung ist nicht vollständig oder der Kontostand muss zuerst abgestimmt werden.'; end if;

  new_receipts := p_bank_balance_cents - s.current_buffer_cents - previous_pending;
  tax_reserve := round(new_receipts::numeric * s.tax_rate_basis_points / 10000)::bigint;
  available_funds := new_receipts - tax_reserve;
  remaining_money := p_bank_balance_cents - previous_pending - tax_reserve;
  -- Canonical priority is independent of client JSON ordering and display names.
  for pot in select * from public.wealth_first_pots
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active
    order by (destination_type = 'service_account') desc nulls last, sort_order, id for share
  loop
    select value into item from jsonb_array_elements(v_allocations) j where j->>'pot_id' = pot.id::text;
    if item is null then raise exception 'Die Verteilung ist nicht vollständig.'; end if;
    if (item->>'allocation_cents')::numeric is distinct from trunc((item->>'allocation_cents')::numeric) then raise exception 'Zuweisungen müssen in ganzen Rappen vorliegen.'; end if;
    amount := (item->>'allocation_cents')::bigint;
    if amount is null or amount < 0 then raise exception 'Zuweisungen dürfen nicht negativ sein.'; end if;
    select coalesce(sum(a.allocation_cents), 0) into already
      from public.wealth_first_distribution_allocations a
      join public.wealth_first_distributions d on d.id = a.distribution_id
      where a.user_id = auth.uid() and a.buchhaltung_id = p_buchhaltung_id
        and a.pot_id = pot.id and d.distribution_month = p_distribution_month;
    target_remaining := greatest(0, pot.monthly_target_cents - already);
    proposed := least(target_remaining, remaining_money);
    if amount > proposed then
      raise exception 'Die Zuweisung für % übersteigt das offene Monatsziel oder die verfügbaren Mittel.', pot.name;
    end if;
    if amount <> proposed and not coalesce((item->>'manual_override')::boolean, false) then
      raise exception 'Der automatische Vorschlag ist veraltet. Bitte neu berechnen oder die Reduktion ausdrücklich angeben.';
    end if;
    remaining_money := remaining_money - amount;
    allocation_total := allocation_total + amount;
  end loop;

  resulting_buffer := least(remaining_money, s.warning_threshold_cents);
  investment_surplus := remaining_money - resulting_buffer;
  total_surplus := previous_pending + investment_surplus;
  surplus_transfer := case when transfer_confirmed then total_surplus else 0 end;
  pending_surplus := total_surplus - surplus_transfer;
  if not target_aware and total_surplus > 0 then
    raise exception 'Bitte die aktuelle App neu laden und die Puffer-Ziel- und Überschussübersicht prüfen.';
  end if;
  if s.current_buffer_cents > s.warning_threshold_cents and investment_surplus > 0 and not excess_release_confirmed then
    raise exception 'Der bisherige Business-Puffer liegt über dem Ziel. Bitte die Freigabe des bisherigen Überhangs ausdrücklich bestätigen.';
  end if;
  if resulting_buffer < 0 then raise exception 'Die geplanten Zuweisungen übersteigen die verfügbaren Mittel.'; end if;
  if p_bank_balance_cents <> tax_reserve + allocation_total + surplus_transfer + resulting_buffer + pending_surplus then
    raise exception 'Die Verteilung stimmt nicht auf den Rappen genau.'; end if;

  insert into public.wealth_first_distributions(id, user_id, buchhaltung_id, idempotency_key,
    distribution_month, distribution_date, bank_balance_cents, previous_buffer_cents, new_receipts_cents,
    tax_rate_basis_points_snapshot, tax_reserve_cents, available_funds_cents,
    allocation_total_cents, buffer_change_cents, resulting_buffer_cents,
    warning_threshold_cents_snapshot, settings_version_snapshot, buffer_target_cents_snapshot,
    previous_pending_surplus_cents_snapshot, investment_surplus_cents, surplus_transfer_cents,
    pending_surplus_cents, surplus_transfer_confirmed_snapshot, excess_buffer_release_confirmed_snapshot)
  values(v_distribution_id, auth.uid(), p_buchhaltung_id, p_idempotency_key,
    p_distribution_month, p_distribution_date, p_bank_balance_cents, s.current_buffer_cents, new_receipts,
    s.tax_rate_basis_points, tax_reserve, available_funds, allocation_total,
    resulting_buffer - s.current_buffer_cents, resulting_buffer, s.warning_threshold_cents, s.version,
    s.warning_threshold_cents, previous_pending, investment_surplus, surplus_transfer,
    pending_surplus, transfer_confirmed, excess_release_confirmed);

  for item in select value from jsonb_array_elements(v_allocations) loop
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
      already_allocated_cents_snapshot, allocation_cents, expected_month_total_cents, exceptional, destination_type_snapshot, manual_override_snapshot)
    values(v_distribution_id, pot.id, auth.uid(), p_buchhaltung_id, pot.name,
      pot.monthly_target_cents, already, amount, already + amount,
      false, coalesce(pot.destination_type, 'private_pot'), coalesce((item->>'manual_override')::boolean, false));
  end loop;
  update public.wealth_first_settings set current_buffer_cents = resulting_buffer, pending_surplus_cents = pending_surplus,
    version = version + 1 where id = s.id;
  return v_distribution_id;
end;
$$;



commit;
