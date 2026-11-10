begin;

-- Manual deployment only. No data backfill, accounting writes, history updates or deletes.
-- NULL on existing rows means classification/date was not recorded at confirmation.
alter table public.wealth_first_pots add column if not exists destination_type text
  check (destination_type in ('service_account', 'private_pot'));
alter table public.wealth_first_distributions add column if not exists distribution_date date;
alter table public.wealth_first_distribution_allocations add column if not exists destination_type_snapshot text
  check (destination_type_snapshot in ('service_account', 'private_pot'));
alter table public.wealth_first_distribution_allocations add column if not exists manual_override_snapshot boolean;
create unique index if not exists wealth_first_one_service_account
  on public.wealth_first_pots(user_id, buchhaltung_id) where destination_type = 'service_account';

-- Reuse the established settings writer and its version lock. Classification is explicit;
-- legacy destinations can be selected by ID so their monthly allocations still count.
create or replace function public.save_wealth_first_settings_v2(
  p_buchhaltung_id uuid, p_expected_version bigint, p_tax_rate_basis_points integer,
  p_warning_threshold_cents bigint, p_initial_buffer_cents bigint, p_pots jsonb
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  next_version bigint;
  service_id uuid;
  existing_service_id uuid;
begin
  next_version := public.save_wealth_first_settings_v1(p_buchhaltung_id, p_expected_version,
    p_tax_rate_basis_points, p_warning_threshold_cents, p_initial_buffer_cents, p_pots);
  if (select count(*) from jsonb_array_elements(p_pots) j where j->>'destination_type' = 'service_account') <> 1
    or exists (select 1 from jsonb_array_elements(p_pots) j
      where coalesce(j->>'destination_type', '') not in ('service_account','private_pot'))
  then raise exception 'Genau ein Servicekonto muss ausdrücklich zugeordnet werden.'; end if;
  select (j->>'id')::uuid into service_id from jsonb_array_elements(p_pots) j
    where j->>'destination_type' = 'service_account' and (j->>'active')::boolean;
  if service_id is null then raise exception 'Das Servicekonto muss aktiv bleiben; zum Aussetzen das Monatsziel auf CHF 0 setzen.'; end if;
  select id into existing_service_id from public.wealth_first_pots
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and destination_type = 'service_account';
  if existing_service_id is not null and existing_service_id <> service_id then
    raise exception 'Das bestehende Servicekonto muss beibehalten werden. Es wird kein zweites Servicekonto angelegt.';
  end if;
  update public.wealth_first_pots p set destination_type = j->>'destination_type'
    from jsonb_array_elements(p_pots) j
    where p.id = (j->>'id')::uuid and p.user_id = auth.uid() and p.buchhaltung_id = p_buchhaltung_id;
  return next_version;
end;
$$;

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
begin
  if auth.uid() is null or p_idempotency_key is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Die Zuweisungen müssen als vollständige Liste vorliegen.';
  end if;
  if jsonb_array_length(p_allocations) not between 1 and 50
    or (select count(*) from jsonb_array_elements(p_allocations)) <>
       (select count(distinct j->>'pot_id') from jsonb_array_elements(p_allocations) j)
    or exists (select 1 from jsonb_array_elements(p_allocations) j
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
      or (select count(*) from public.wealth_first_distribution_allocations a where a.distribution_id = previous.id)
         <> jsonb_array_length(p_allocations)
      or exists (select 1 from jsonb_array_elements(p_allocations) j where not exists (
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
  if p_distribution_date is null or not isfinite(p_distribution_date)
    or p_distribution_date not between date '0001-01-01' and date '9999-12-31'
  then raise exception 'Ein gültiges Verteilungsdatum ist erforderlich.'; end if;
  if exists (select 1 from public.wealth_first_distributions d
    where d.user_id = auth.uid() and d.buchhaltung_id = p_buchhaltung_id
      and coalesce(d.distribution_date, (d.confirmed_at at time zone 'Europe/Zurich')::date) > p_distribution_date)
    or exists (select 1 from public.wealth_first_reconciliations r
      where r.user_id = auth.uid() and r.buchhaltung_id = p_buchhaltung_id
        and (r.confirmed_at at time zone 'Europe/Zurich')::date > p_distribution_date)
  then raise exception 'Das Verteilungsdatum liegt vor einer gespeicherten Verteilung oder Puffer-Abstimmung. Eine rückwirkende Änderung benötigt einen separaten Korrekturablauf.'; end if;
  if not exists (select 1 from public.wealth_first_pots where user_id = auth.uid()
    and buchhaltung_id = p_buchhaltung_id and destination_type = 'service_account' and active)
  then raise exception 'Bitte das Servicekonto einmalig in den Einstellungen zuordnen und speichern.'; end if;
  if p_distribution_month is null or p_distribution_month <> date_trunc('month', p_distribution_month)::date
    or p_bank_balance_cents is null or p_bank_balance_cents < s.current_buffer_cents
    or jsonb_typeof(p_allocations) is distinct from 'array'
    or jsonb_array_length(p_allocations) <> (select count(*) from public.wealth_first_pots where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active)
    or (select count(*) from jsonb_array_elements(p_allocations)) <>
       (select count(distinct j->>'pot_id') from jsonb_array_elements(p_allocations) j)
  then raise exception 'Die Verteilung ist nicht vollständig oder der Kontostand muss zuerst abgestimmt werden.'; end if;

  new_receipts := p_bank_balance_cents - s.current_buffer_cents;
  tax_reserve := round(new_receipts::numeric * s.tax_rate_basis_points / 10000)::bigint;
  available_funds := new_receipts - tax_reserve;
  remaining_money := p_bank_balance_cents - tax_reserve;
  -- Canonical priority is independent of client JSON ordering and display names.
  for pot in select * from public.wealth_first_pots
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id and active
    order by (destination_type = 'service_account') desc nulls last, sort_order, id for share
  loop
    select value into item from jsonb_array_elements(p_allocations) j where j->>'pot_id' = pot.id::text;
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

  resulting_buffer := s.current_buffer_cents + available_funds - allocation_total;
  if resulting_buffer < 0 then raise exception 'Die geplanten Zuweisungen übersteigen die verfügbaren Mittel.'; end if;
  if p_bank_balance_cents <> tax_reserve + allocation_total + resulting_buffer then
    raise exception 'Die Verteilung stimmt nicht auf den Rappen genau.'; end if;

  insert into public.wealth_first_distributions(id, user_id, buchhaltung_id, idempotency_key,
    distribution_month, distribution_date, bank_balance_cents, previous_buffer_cents, new_receipts_cents,
    tax_rate_basis_points_snapshot, tax_reserve_cents, available_funds_cents,
    allocation_total_cents, buffer_change_cents, resulting_buffer_cents,
    warning_threshold_cents_snapshot, settings_version_snapshot)
  values(v_distribution_id, auth.uid(), p_buchhaltung_id, p_idempotency_key,
    p_distribution_month, p_distribution_date, p_bank_balance_cents, s.current_buffer_cents, new_receipts,
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
      already_allocated_cents_snapshot, allocation_cents, expected_month_total_cents, exceptional, destination_type_snapshot, manual_override_snapshot)
    values(v_distribution_id, pot.id, auth.uid(), p_buchhaltung_id, pot.name,
      pot.monthly_target_cents, already, amount, already + amount,
      false, coalesce(pot.destination_type, 'private_pot'), coalesce((item->>'manual_override')::boolean, false));
  end loop;
  update public.wealth_first_settings set current_buffer_cents = resulting_buffer,
    version = version + 1 where id = s.id;
  return v_distribution_id;
end;
$$;


-- Old confirmation would bypass date and priority validation; retain its definition only.
revoke execute on function public.confirm_wealth_first_distribution_v1(uuid,uuid,date,bigint,bigint,bigint,jsonb) from authenticated;
revoke execute on function public.save_wealth_first_settings_v1(uuid,bigint,integer,bigint,bigint,jsonb) from authenticated;
revoke all on function public.save_wealth_first_settings_v2(uuid,bigint,integer,bigint,bigint,jsonb) from public;
revoke all on function public.confirm_wealth_first_distribution_v2(uuid,uuid,date,date,bigint,bigint,bigint,jsonb) from public;
grant execute on function public.save_wealth_first_settings_v2(uuid,bigint,integer,bigint,bigint,jsonb) to authenticated;
grant execute on function public.confirm_wealth_first_distribution_v2(uuid,uuid,date,date,bigint,bigint,bigint,jsonb) to authenticated;

commit;
