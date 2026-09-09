-- MANUAL Supabase SQL Editor migration. No production records are rewritten.
-- Requires the existing invoice/receivable migrations through 202608280002.
begin;

alter table public.invoice_payments add column if not exists request_id uuid;
alter table public.invoice_payments add column if not exists expected_settled_cents bigint;
alter table public.invoice_payments add column if not exists exchange_rate numeric(12,6);
alter table public.invoice_payments add column if not exists exchange_rate_source text;
alter table public.invoice_payments add column if not exists exchange_rate_manual boolean;
alter table public.invoice_payments add column if not exists reporting_currency text;
alter table public.invoice_payments add column if not exists amount_reporting numeric(14,2);
alter table public.invoice_payments add column if not exists overpayment_confirmed boolean;
alter table public.incomes add column if not exists invoice_payment_id uuid;
alter table public.bank_fees add column if not exists invoice_payment_id uuid;

-- Partial indexes never reinterpret or deduplicate historical rows (new keys are NULL).
create unique index if not exists invoice_payment_request_unique
  on public.invoice_payments(user_id, request_id) where request_id is not null;
create unique index if not exists invoice_payment_income_unique
  on public.invoice_payments(income_id) where request_id is not null;
create unique index if not exists income_payment_unique
  on public.incomes(invoice_payment_id) where invoice_payment_id is not null;
create unique index if not exists fee_payment_unique
  on public.bank_fees(invoice_payment_id) where invoice_payment_id is not null;

-- Retain the old one-receivable-per-invoice guard for legacy rows. Payment incomes
-- are instead constrained one-to-one by their new key and deferred pair validation.
create or replace function public.prevent_duplicate_invoice_income()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.invoice_id is not null and new.invoice_payment_id is null and exists (
    select 1 from public.incomes i where i.invoice_id = new.invoice_id
      and i.invoice_payment_id is null and i.id is distinct from new.id
  ) then
    raise exception 'Für diese Rechnung existiert bereits eine verknüpfte Einnahme.';
  end if;
  return new;
end;
$$;

-- Add restrictive policies; retain every existing ownership policy.
do $$
declare t text; operation text; policy_name text; predicate text;
begin
  foreach t in array array['invoice_payments', 'incomes', 'bank_fees'] loop
    foreach operation in array array['insert', 'update', 'delete'] loop
      policy_name := t || '_atomic_' || operation;
      predicate := case when t = 'invoice_payments' then 'false'
        when t = 'incomes' then 'invoice_id is null and invoice_payment_id is null'
        else 'invoice_payment_id is null and not exists (select 1 from public.incomes i where i.id = related_income_id and i.invoice_id is not null)' end;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = policy_name) then
        execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
          policy_name, t, operation, case when operation = 'insert' then 'with check (' || predicate || ')'
          when operation = 'delete' then 'using (' || predicate || ')'
          else 'using (' || predicate || ') with check (' || predicate || ')' end);
      end if;
    end loop;
  end loop;
end $$;

-- Managed history is append-only, including via cascading legacy foreign keys.
create or replace function public.guard_invoice_payment_history()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'invoice_payments' then
    raise exception 'Zahlungshistorie ist unveränderlich. Korrektur muss separat abgestimmt werden.';
  elsif old.invoice_payment_id is not null then
    raise exception 'Zahlungshistorie ist unveränderlich. Korrektur muss separat abgestimmt werden.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.validate_invoice_payment_pair()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.invoice_payments%rowtype; i public.incomes%rowtype;
begin
  if tg_table_name = 'invoice_payments' then
    if new.request_id is null then return new; end if;
    select * into p from public.invoice_payments where id = new.id;
  else
    if new.invoice_payment_id is null then return new; end if;
    select * into p from public.invoice_payments where id = new.invoice_payment_id;
  end if;
  if p.id is null or p.request_id is null or p.income_id is null then
    raise exception 'Zahlung und Einnahme müssen gemeinsam gespeichert werden.';
  end if;
  select * into i from public.incomes where id = p.income_id;
  if i.id is null or i.invoice_payment_id is distinct from p.id
    or i.invoice_id is distinct from p.invoice_id or i.user_id is distinct from p.user_id
    or i.buchhaltung_id is distinct from p.buchhaltung_id or i.currency is distinct from p.currency
    or i.payment_date is distinct from p.payment_date or i.status <> 'bezahlt'
    or i.payment_received_original is distinct from p.amount_cents / 100.0
    or i.payment_received_reporting is distinct from p.amount_reporting
    or i.exchange_rate is distinct from p.exchange_rate
    or i.reporting_currency is distinct from p.reporting_currency
    or not exists (select 1 from public.invoices v where v.id = p.invoice_id
      and v.user_id = p.user_id and v.buchhaltung_id = p.buchhaltung_id and v.currency = p.currency)
  then raise exception 'Zahlung/Einnahme stimmt nicht mit der Rechnung und Buchhaltung überein.'; end if;
  if p.fee_cents > 0 and not exists (select 1 from public.bank_fees f
    where f.invoice_payment_id = p.id and f.related_income_id = i.id
      and f.user_id = p.user_id and f.buchhaltung_id = p.buchhaltung_id
      and f.original_amount = p.fee_cents / 100.0 and f.currency = p.currency)
  then raise exception 'Der bestätigte Gebührenausgleich fehlt.'; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['invoice_payments', 'incomes', 'bank_fees'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'guard_invoice_payment_history') then
      execute format('create trigger guard_invoice_payment_history before update or delete on public.%I for each row execute function public.guard_invoice_payment_history()', t);
    end if;
  end loop;
  foreach t in array array['invoice_payments', 'incomes'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'validate_invoice_payment_pair') then
      execute format('create constraint trigger validate_invoice_payment_pair after insert or update on public.%I deferrable initially deferred for each row execute function public.validate_invoice_payment_pair()', t);
    end if;
  end loop;
end $$;

create or replace function public.record_invoice_payment_v1(
  p_invoice_id uuid, p_buchhaltung_id uuid, p_request_id uuid,
  p_payment_date date, p_amount_cents integer, p_currency text,
  p_expected_settled_cents bigint, p_fee_cents integer default 0,
  p_note text default null, p_confirm_overpayment boolean default false,
  p_exchange_rate numeric default 1, p_exchange_rate_source text default 'Identisch',
  p_exchange_rate_manual boolean default false
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.invoices%rowtype; b public.buchhaltungen%rowtype;
  previous public.invoice_payments%rowtype; settled bigint;
  payment_id uuid := gen_random_uuid(); income_id uuid := gen_random_uuid();
  rate numeric; factor numeric; reporting_amount numeric; reporting_fee numeric;
begin
  if auth.uid() is null or p_request_id is null then raise exception 'Anmeldung und Anfrage-Schlüssel erforderlich.'; end if;
  select * into b from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid() for share;
  if not found then raise exception 'Buchhaltung wurde nicht gefunden.'; end if;
  select * into v from public.invoices where id = p_invoice_id and user_id = auth.uid()
    and buchhaltung_id = b.id for update;
  if not found then raise exception 'Rechnung wurde nicht gefunden.'; end if;

  -- Check retries before status or current balance, including an already closed invoice.
  select * into previous from public.invoice_payments where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.invoice_id is distinct from p_invoice_id or previous.buchhaltung_id is distinct from p_buchhaltung_id
      or previous.payment_date is distinct from p_payment_date or previous.amount_cents is distinct from p_amount_cents
      or previous.currency is distinct from p_currency or previous.fee_cents is distinct from p_fee_cents
      or previous.note is distinct from nullif(trim(p_note), '')
      or previous.expected_settled_cents is distinct from p_expected_settled_cents
      or previous.overpayment_confirmed is distinct from p_confirm_overpayment
      or previous.exchange_rate_manual is distinct from p_exchange_rate_manual
      or (p_exchange_rate_manual and previous.exchange_rate is distinct from round(p_exchange_rate, 6))
    then raise exception 'Dieser Anfrage-Schlüssel gehört zu einer anderen Zahlung.'; end if;
    return previous.id;
  end if;
  if b.status <> 'aktiv' then raise exception 'Diese Buchhaltung ist abgeschlossen und schreibgeschützt.'; end if;
  if b.reporting_currency <> (case when b.country = 'Schweiz' then 'CHF' else 'EUR' end) then
    raise exception 'Berichtswährung der Buchhaltung muss geprüft werden.';
  end if;
  if p_payment_date is null or not isfinite(p_payment_date) or p_payment_date > (now() at time zone 'Europe/Berlin')::date
    or p_payment_date < b.start_date or (b.end_date is not null and p_payment_date > b.end_date)
    or p_amount_cents is null or p_amount_cents <= 0 or p_fee_cents is null or p_fee_cents < 0
    or p_expected_settled_cents is null or p_confirm_overpayment is null or p_exchange_rate_manual is null
    or p_currency is distinct from v.currency
  then raise exception 'Zahlungsdatum, Betrag oder Rechnungswährung ist ungültig.'; end if;
  if v.status not in ('Ausgestellt', 'Versendet', 'Teilweise bezahlt') then
    raise exception 'Zahlungen sind nur für offene ausgestellte Rechnungen möglich.';
  end if;
  if exists (select 1 from public.invoice_payments p where p.invoice_id = v.id
      and (p.request_id is null or p.user_id <> v.user_id or p.buchhaltung_id <> v.buchhaltung_id or p.currency <> v.currency))
    or exists (select 1 from public.incomes i where (i.invoice_id = v.id or i.id = v.income_id)
      and i.invoice_payment_id is null and (i.payment_date is not null or i.payment_received_original <> 0
        or i.payment_received_reporting <> 0 or i.status <> 'offen'))
  then raise exception 'Historische Zahlungen sind nicht eindeutig abgestimmt. Bitte vor weiteren Zahlungen prüfen; es wurden keine Daten verändert.'; end if;
  select coalesce(sum(amount_cents::bigint + fee_cents), 0) into settled
    from public.invoice_payments where invoice_id = v.id and user_id = auth.uid() and buchhaltung_id = b.id;
  if settled <> v.paid_total_cents then raise exception 'Historischer Zahlungssaldo muss zuerst geprüft werden.'; end if;
  if settled <> p_expected_settled_cents then raise exception 'Der offene Betrag hat sich geändert. Bitte Rechnung neu laden.'; end if;
  if p_fee_cents > 0 and (nullif(trim(p_note), '') is null or settled + p_amount_cents::bigint + p_fee_cents > v.gross_total_cents) then
    raise exception 'Gebührenausgleich benötigt eine Begründung und darf den Restbetrag nicht überschreiten.';
  end if;
  if settled + p_amount_cents::bigint > v.gross_total_cents and not p_confirm_overpayment then
    raise exception 'Überzahlung muss ausdrücklich bestätigt werden.';
  end if;
  rate := case when v.currency = b.reporting_currency then 1 else round(p_exchange_rate, 6) end;
  if rate is null or rate <= 0 or rate::text in ('NaN', 'Infinity', '-Infinity')
    or nullif(trim(p_exchange_rate_source), '') is null then raise exception 'Gültiger historischer Wechselkurs erforderlich.'; end if;
  factor := case when v.currency = b.reporting_currency then 1 when v.currency = 'CHF' then rate else 1 / rate end;
  reporting_amount := round(p_amount_cents / 100.0 * factor, 2);
  reporting_fee := round(p_fee_cents / 100.0 * factor, 2);

  insert into public.incomes(id, user_id, buchhaltung_id, invoice_id, invoice_payment_id,
    invoice_date, payment_date, customer_project, category, invoice_amount_original, payment_received_original,
    currency, tax_mode, exchange_rate, exchange_rate_source, exchange_rate_manual, reporting_currency,
    invoice_amount_reporting, payment_received_reporting, difference_original, difference_reporting, status, description)
  values (income_id, auth.uid(), b.id, v.id, payment_id, v.issue_date, p_payment_date,
    coalesce(v.invoice_number, 'Rechnung') || ' · ' || coalesce(v.customer_snapshot->>'company_name', 'Kunde'),
    'Rechnung', (p_amount_cents::bigint + p_fee_cents) / 100.0, p_amount_cents / 100.0,
    v.currency, 'BRUTTO', rate, p_exchange_rate_source, p_exchange_rate_manual, b.reporting_currency,
    reporting_amount + reporting_fee, reporting_amount, p_fee_cents / 100.0, reporting_fee, 'bezahlt',
    'Zahlung zu Rechnung ' || coalesce(v.invoice_number, v.id::text));
  insert into public.invoice_payments(id, invoice_id, income_id, user_id, buchhaltung_id, payment_date,
    amount_cents, currency, fee_cents, note, request_id, expected_settled_cents, exchange_rate,
    exchange_rate_source, exchange_rate_manual, reporting_currency, amount_reporting, overpayment_confirmed)
  values (payment_id, v.id, income_id, auth.uid(), b.id, p_payment_date, p_amount_cents, v.currency,
    p_fee_cents, nullif(trim(p_note), ''), p_request_id, p_expected_settled_cents, rate,
    p_exchange_rate_source, p_exchange_rate_manual, b.reporting_currency, reporting_amount, p_confirm_overpayment);
  if p_fee_cents > 0 then
    insert into public.bank_fees(user_id, buchhaltung_id, fee_date, original_amount, currency, fee_type,
      description, exchange_rate, exchange_rate_source, exchange_rate_manual, reporting_currency,
      amount_reporting, related_income_id, invoice_payment_id)
    values (auth.uid(), b.id, p_payment_date, p_fee_cents / 100.0, v.currency, 'Zahlungsdifferenz aus Einnahme',
      'Bereits im Zahlungseingang abgezogen: ' || p_note, rate, p_exchange_rate_source,
      p_exchange_rate_manual, b.reporting_currency, reporting_fee, income_id, payment_id);
  end if;
  settled := settled + p_amount_cents::bigint + p_fee_cents;
  update public.invoices set paid_total_cents = settled,
    status = case when settled >= gross_total_cents then 'Bezahlt' else 'Teilweise bezahlt' end
    where id = v.id and user_id = auth.uid() and buchhaltung_id = b.id;
  return payment_id;
end;
$$;

create or replace function public.cancel_invoice_v1(p_invoice_id uuid, p_buchhaltung_id uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.invoices%rowtype;
begin
  if auth.uid() is null or p_confirm is distinct from true then raise exception 'Stornierung bitte bestätigen.'; end if;
  perform 1 from public.buchhaltungen where id = p_buchhaltung_id and user_id = auth.uid() and status = 'aktiv' for share;
  if not found then raise exception 'Buchhaltung fehlt oder ist schreibgeschützt.'; end if;
  select * into v from public.invoices where id = p_invoice_id and user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id for update;
  if not found then raise exception 'Rechnung wurde nicht gefunden.'; end if;
  if v.status = 'Storniert' then return; end if;
  if v.paid_total_cents <> 0 or v.status in ('Bezahlt', 'Teilweise bezahlt')
    or exists (select 1 from public.invoice_payments where invoice_id = v.id)
    or exists (select 1 from public.incomes where (invoice_id = v.id or id = v.income_id)
      and (payment_date is not null or payment_received_original <> 0 or payment_received_reporting <> 0 or status <> 'offen'))
  then raise exception 'Es bestehen Zahlungen oder unklare Altbuchungen. Stornierung erst nach separater buchhalterischer Klärung; keine automatische Rückbuchung.'; end if;
  update public.invoices set status = 'Storniert' where id = v.id and user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id;
end;
$$;

-- Direct status writes cannot bypass the locked payment/cancellation operations.
create or replace function public.guard_invoice_lifecycle()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Entwurf' then raise exception 'Ausgestellte Rechnungen bleiben historisch gespeichert.'; end if;
    return old;
  end if;
  if old.status <> 'Entwurf' and (new.gross_total_cents, new.net_total_cents, new.vat_total_cents,
      new.currency, new.user_id, new.buchhaltung_id, new.invoice_number, new.issue_date,
      new.customer_snapshot, new.sender_snapshot, new.bank_snapshot, new.due_date, new.tax_note)
    is distinct from (old.gross_total_cents, old.net_total_cents, old.vat_total_cents,
      old.currency, old.user_id, old.buchhaltung_id, old.invoice_number, old.issue_date,
      old.customer_snapshot, old.sender_snapshot, old.bank_snapshot, old.due_date, old.tax_note)
  then raise exception 'Historische Rechnungsbeträge und Zuordnung sind unveränderlich.'; end if;
  if current_user in ('authenticated', 'anon') and (
    new.paid_total_cents is distinct from old.paid_total_cents
    or (new.status is distinct from old.status and not (old.status = 'Ausgestellt' and new.status = 'Versendet'))
  ) then raise exception 'Statusänderungen sind nur über den Rechnungsablauf möglich.'; end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'guard_invoice_lifecycle') then
    create trigger guard_invoice_lifecycle before update or delete on public.invoices
      for each row execute function public.guard_invoice_lifecycle();
  end if;
end $$;

-- Serialize item edits with issuing an invoice; the old draft editor may still
-- make several requests, but cannot mutate items after issue_invoice locks/finalizes.
create or replace function public.guard_issued_invoice_items()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare parent public.invoices%rowtype;
begin
  if tg_op <> 'INSERT' then
    select * into parent from public.invoices where id = old.invoice_id for update;
    if parent.status is distinct from 'Entwurf' then raise exception 'Ausgestellte Rechnungspositionen sind unveränderlich.'; end if;
  end if;
  if tg_op <> 'DELETE' then
    select * into parent from public.invoices where id = new.invoice_id for update;
    if parent.status is distinct from 'Entwurf' or parent.user_id is distinct from new.user_id
      or parent.buchhaltung_id is distinct from new.buchhaltung_id or parent.currency is distinct from new.currency
    then raise exception 'Rechnungsposition gehört nicht zu einem passenden Entwurf.'; end if;
    return new;
  end if;
  return old;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.invoice_items'::regclass and tgname = 'guard_issued_invoice_items') then
    create trigger guard_issued_invoice_items before insert or update or delete on public.invoice_items
      for each row execute function public.guard_issued_invoice_items();
  end if;
end $$;

revoke all on function public.record_invoice_payment_v1(uuid,uuid,uuid,date,integer,text,bigint,integer,text,boolean,numeric,text,boolean) from public;
revoke all on function public.cancel_invoice_v1(uuid,uuid,boolean) from public;
grant execute on function public.record_invoice_payment_v1(uuid,uuid,uuid,date,integer,text,bigint,integer,text,boolean,numeric,text,boolean) to authenticated;
grant execute on function public.cancel_invoice_v1(uuid,uuid,boolean) to authenticated;

commit;
