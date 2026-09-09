-- OPTIONAL READ-ONLY inspection in Supabase SQL Editor before the manual migration.
-- Inspect drift against the repository; this file performs no writes.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('invoices', 'invoice_payments', 'incomes', 'bank_fees', 'buchhaltungen')
order by table_name, ordinal_position;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
  and tablename in ('invoices', 'invoice_payments', 'incomes', 'bank_fees')
order by tablename, policyname;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in ('invoices', 'invoice_payments', 'incomes', 'bank_fees');

select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
  and c.relname in ('invoices', 'invoice_payments', 'incomes', 'bank_fees');

-- Existing payments are not migrated. These invoices require manual reconciliation
-- before another payment through the new workflow.
select v.id as invoice_id, v.buchhaltung_id, v.status, v.currency,
  v.gross_total_cents, v.paid_total_cents,
  (select count(*) from public.invoice_payments p where p.invoice_id = v.id) as payment_count,
  (select coalesce(sum(p.amount_cents::bigint + p.fee_cents), 0)
    from public.invoice_payments p where p.invoice_id = v.id) as recorded_settlement_cents,
  (select count(*) from public.incomes i where i.invoice_id = v.id) as income_count
from public.invoices v
where v.paid_total_cents <> 0 or exists (select 1 from public.invoice_payments p where p.invoice_id = v.id);

-- Scope inconsistencies: expected result is zero rows. Do not auto-correct any hits.
select p.id as payment_id, p.invoice_id, p.buchhaltung_id
from public.invoice_payments p join public.invoices v on v.id = p.invoice_id
left join public.incomes i on i.id = p.income_id
where p.user_id <> v.user_id or p.buchhaltung_id <> v.buchhaltung_id or p.currency <> v.currency
  or (i.id is not null and (i.user_id <> p.user_id or i.buchhaltung_id <> p.buchhaltung_id));
