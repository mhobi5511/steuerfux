begin;

-- Run manually AFTER 202611100002_wealth_first_buffer_target.sql.
-- This migration only adds editable transfer-destination configuration. It neither
-- moves money nor changes past distributions, allocations, accounting or snapshots.
alter table public.wealth_first_settings add column if not exists tax_transfer_account_key text
  check (tax_transfer_account_key in ('glkb_tax', 'glkb_service', 'revolut', 'yuh'));
alter table public.wealth_first_pots add column if not exists transfer_account_key text
  check (transfer_account_key in ('glkb_tax', 'glkb_service', 'revolut', 'yuh'));

create or replace function public.save_wealth_first_settings_v3(
  p_buchhaltung_id uuid, p_expected_version bigint, p_tax_rate_basis_points integer,
  p_warning_threshold_cents bigint, p_tax_transfer_account_key text,
  p_initial_buffer_cents bigint, p_pots jsonb
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  next_version bigint;
begin
  if p_tax_transfer_account_key not in ('glkb_tax', 'glkb_service', 'revolut', 'yuh')
    or exists (select 1 from jsonb_array_elements(p_pots) j
      where coalesce(j->>'transfer_account_key', '') not in ('glkb_tax', 'glkb_service', 'revolut', 'yuh')) then
    raise exception 'Bitte für Steuern und jedes Ziel ein gültiges Überweisungskonto wählen.';
  end if;
  next_version := public.save_wealth_first_settings_v2(p_buchhaltung_id, p_expected_version,
    p_tax_rate_basis_points, p_warning_threshold_cents, p_initial_buffer_cents, p_pots);
  update public.wealth_first_settings set tax_transfer_account_key = p_tax_transfer_account_key
    where user_id = auth.uid() and buchhaltung_id = p_buchhaltung_id;
  update public.wealth_first_pots p set transfer_account_key = j->>'transfer_account_key'
    from jsonb_array_elements(p_pots) j
    where p.id = (j->>'id')::uuid and p.user_id = auth.uid() and p.buchhaltung_id = p_buchhaltung_id;
  return next_version;
end;
$$;

revoke execute on function public.save_wealth_first_settings_v2(uuid,bigint,integer,bigint,bigint,jsonb) from authenticated;
revoke all on function public.save_wealth_first_settings_v3(uuid,bigint,integer,bigint,text,bigint,jsonb) from public;
grant execute on function public.save_wealth_first_settings_v3(uuid,bigint,integer,bigint,text,bigint,jsonb) to authenticated;

commit;
