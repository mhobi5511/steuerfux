-- SAFE, ADDITIVE-ONLY PERFORMANCE MIGRATION
--
-- This file intentionally contains only CREATE INDEX IF NOT EXISTS statements.
-- Run it manually in Supabase only after a
-- verified backup and live-schema review. CREATE INDEX can consume I/O and take
-- short locks, so use a quiet period for the production project.

create index if not exists idx_incomes_buchhaltung_invoice_date
  on public.incomes (buchhaltung_id, invoice_date desc);

create index if not exists idx_expenses_buchhaltung_expense_date
  on public.expenses (buchhaltung_id, expense_date desc);

create index if not exists idx_bank_fees_buchhaltung_fee_date
  on public.bank_fees (buchhaltung_id, fee_date desc);

create index if not exists idx_trips_buchhaltung_start_at
  on public.trips (buchhaltung_id, start_at desc);

create index if not exists idx_reimbursements_buchhaltung_date
  on public.reimbursements (buchhaltung_id, reimbursement_date desc);

create index if not exists idx_depreciations_buchhaltung_acquisition_date
  on public.depreciations (buchhaltung_id, acquisition_date desc);

create index if not exists idx_invoices_buchhaltung_issue_date
  on public.invoices (buchhaltung_id, issue_date desc);

create index if not exists idx_invoices_buchhaltung_status_due_date
  on public.invoices (buchhaltung_id, status, due_date);

create index if not exists idx_customers_buchhaltung_company_name
  on public.customers (buchhaltung_id, company_name);

create index if not exists idx_invoice_payments_buchhaltung_invoice_date
  on public.invoice_payments (buchhaltung_id, invoice_id, payment_date desc);

create index if not exists idx_receipts_buchhaltung_expense
  on public.receipts (buchhaltung_id, expense_id);
