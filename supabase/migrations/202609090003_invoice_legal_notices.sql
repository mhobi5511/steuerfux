-- Additive presentation metadata only. This migration deliberately does not
-- update invoices, accounting entries, totals, or invoice numbers.
alter table public.invoices
  add column if not exists legal_notices jsonb;

alter table public.invoice_settings
  add column if not exists default_legal_notices jsonb not null default '{"art10_mwstg": false, "reverse_charge": false, "custom_note": null}'::jsonb;

comment on column public.invoices.legal_notices is
  'Optional invoice presentation notices. Null preserves pre-migration historical tax_note rendering.';
comment on column public.invoice_settings.default_legal_notices is
  'Defaults applied by the editor to newly created invoice drafts only.';
