alter table public.invoice_settings
  add column if not exists default_payment_qr_enabled boolean not null default false,
  add column if not exists default_use_uploaded_qr boolean not null default false;

alter table public.invoices
  add column if not exists qr_payment_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists vat_exemption_type text check (
    vat_exemption_type is null
    or vat_exemption_type in ('de-19-ustg', 'ch-art-10-mwstg')
  );

update public.invoices i
set vat_exemption_type = case
  when i.kleinunternehmer and b.country = 'Schweiz' then 'ch-art-10-mwstg'
  when i.kleinunternehmer then 'de-19-ustg'
  else null
end
from public.buchhaltungen b
where i.buchhaltung_id = b.id
  and i.user_id = b.user_id
  and i.vat_exemption_type is null;

update public.invoices i
set tax_note = case
  when i.kleinunternehmer and b.country = 'Schweiz' then 'Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG.'
  when i.kleinunternehmer then 'Nach der Kleinunternehmerregelung laut §19 UStG entfällt die Verrechnung der Umsatzsteuer.'
  else null
end
from public.buchhaltungen b
where i.buchhaltung_id = b.id
  and i.user_id = b.user_id
  and i.kleinunternehmer
  and (
    i.tax_note is null
    or i.tax_note = 'Nach der Kleinunternehmerregelung laut §19 UStG entfällt die Verrechnung der Umsatzsteuer.'
  );
