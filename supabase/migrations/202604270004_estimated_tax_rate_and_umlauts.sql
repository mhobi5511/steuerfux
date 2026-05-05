alter table public.settings
  add column if not exists estimated_tax_rate numeric(5,2) not null default 0;

alter table public.settings
  drop constraint if exists settings_estimated_tax_rate_check;

alter table public.settings
  add constraint settings_estimated_tax_rate_check
  check (estimated_tax_rate between 0 and 100);

update public.settings
set default_home_address = 'Ottobrunn, München, Deutschland'
where default_home_address = 'Ottobrunn, MÃ¼nchen, Deutschland';

update public.bank_fees
set fee_type = 'Bankgebühr'
where fee_type = 'BankgebÃ¼hr';

alter table public.bank_fees
  drop constraint if exists bank_fees_fee_type_check;

alter table public.bank_fees
  add constraint bank_fees_fee_type_check
  check (
    fee_type in (
      'Bankgebühr',
      'Wechselkursverlust',
      'Zahlungsanbieter',
      'Zahlungsdifferenz aus Einnahme',
      'Sonstiges'
    )
  );

update public.trip_stops
set purpose = 'Geschäftlich'
where purpose = 'GeschÃ¤ftlich';

update public.trip_stops
set purpose = 'Übernachtung geschäftlich'
where purpose = 'Ãœbernachtung geschÃ¤ftlich';

alter table public.trip_stops
  drop constraint if exists trip_stops_purpose_check;

alter table public.trip_stops
  add constraint trip_stops_purpose_check
  check (
    purpose in (
      'Geschäftlich',
      'Übernachtung geschäftlich',
      'Privat',
      'Transit'
    )
  );
