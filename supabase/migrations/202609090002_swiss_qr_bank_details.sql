-- Additive-only support for Swiss QR-bill creditor details.
-- Deliberately does not update existing rows or historical invoice snapshots.
alter table public.bank_accounts
  add column if not exists qr_iban text,
  add column if not exists swiss_qr_street text,
  add column if not exists swiss_qr_house_number text,
  add column if not exists swiss_qr_postal_code text,
  add column if not exists swiss_qr_city text,
  add column if not exists swiss_qr_country text;

comment on column public.bank_accounts.qr_iban is
  'Optional Swiss QR-IBAN. A valid QR reference is required before this account can be encoded.';
comment on column public.bank_accounts.swiss_qr_street is
  'Structured creditor street used for Swiss QR-bill generation.';
comment on column public.bank_accounts.swiss_qr_house_number is
  'Structured creditor house number used for Swiss QR-bill generation.';
comment on column public.bank_accounts.swiss_qr_postal_code is
  'Structured creditor postal code used for Swiss QR-bill generation.';
comment on column public.bank_accounts.swiss_qr_city is
  'Structured creditor city used for Swiss QR-bill generation.';
comment on column public.bank_accounts.swiss_qr_country is
  'ISO alpha-2 creditor country code used for Swiss QR-bill generation.';
