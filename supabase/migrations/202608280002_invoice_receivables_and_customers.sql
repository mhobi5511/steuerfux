begin;

create or replace function public.normalize_customer_match(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(value, '')), '\\s+', ' ', 'g'))
$$;

create or replace function public.prevent_duplicate_customer()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.customers c
    where c.user_id = new.user_id
      and c.buchhaltung_id = new.buchhaltung_id
      and c.id is distinct from new.id
      and public.normalize_customer_match(c.company_name) = public.normalize_customer_match(new.company_name)
      and public.normalize_customer_match(c.email) = public.normalize_customer_match(new.email)
  ) then
    raise exception 'Ein Empfänger mit diesem Namen und dieser E-Mail-Adresse existiert bereits.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_duplicate_customer on public.customers;
create trigger prevent_duplicate_customer
before insert or update of company_name, email, buchhaltung_id on public.customers
for each row execute function public.prevent_duplicate_customer();

create or replace function public.prevent_duplicate_invoice_income()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_id is not null and exists (
    select 1
    from public.incomes i
    where i.invoice_id = new.invoice_id
      and i.id is distinct from new.id
  ) then
    raise exception 'Für diese Rechnung existiert bereits eine verknüpfte Einnahme.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_duplicate_invoice_income on public.incomes;
create trigger prevent_duplicate_invoice_income
before insert or update of invoice_id on public.incomes
for each row execute function public.prevent_duplicate_invoice_income();

commit;
