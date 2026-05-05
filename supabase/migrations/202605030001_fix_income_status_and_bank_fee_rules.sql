begin;

update public.incomes
set status = 'bezahlt'
where status = 'teilweise bezahlt';

update public.incomes
set
  status = 'offen',
  payment_received_original = 0,
  payment_received_reporting = 0,
  difference_original = invoice_amount_original,
  difference_reporting = invoice_amount_reporting
where payment_date is null;

delete from public.bank_fees bf
using public.incomes i
where bf.related_income_id = i.id
  and bf.fee_type = 'Zahlungsdifferenz aus Einnahme'
  and (
    i.payment_date is null
    or i.status <> 'bezahlt'
  );

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'incomes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.incomes drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.incomes
  add constraint incomes_status_check
  check (status in ('offen', 'bezahlt'));

commit;
