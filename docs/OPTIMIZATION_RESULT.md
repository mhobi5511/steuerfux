# Optimization Result

## Safety boundary

All implemented changes are repository/code changes. This work did not connect to Supabase, inspect production rows, execute SQL, rewrite financial history, mutate issued invoice snapshots, or run a reset/delete operation. The existing `.env.local` was not read or changed.

The new migration file is a proposal only. Production remains the sole authoritative database, and deployment of that SQL is a separate manual operation.

## Implemented

### Correctness and bookkeeping context

- New entries now default to the active book's reporting currency: CHF in a Swiss book and EUR in a German book.
- Changing country/reporting currency is rejected once the active book has financial history, or when the history check cannot be completed. Closed books remain rejected.
- Private trip segments still count toward route distance but no longer produce a business kilometre deduction for new/edited trips.
- Same-day German-model travel of eight hours or less no longer receives an arrival/departure meal allowance.
- One-month invoice terms now clamp to the target month (for example, 31 January to 28/29 February) using timezone-independent calendar arithmetic.
- Prior-year depreciations are included while their useful life is active in the selected report year. No stored depreciation row was recalculated.

The embedded Swiss/German travel amounts and kilometre rate were deliberately not replaced. They require a versioned, country/canton-specific policy before they can be treated as authoritative.

### Data safety and security

- Receipt files are validated server-side (PDF/JPG/PNG/HEIC/HEIF, maximum 6 MB) before the expense insert. A declared disallowed MIME type can no longer bypass validation merely through its extension.
- Receipt uploads use random non-overwriting paths. Existing receipt metadata is preserved; if new metadata fails, only the newly uploaded orphan object is removed.
- The exchange-rate route now requires an authenticated user, validates dates and fallbacks, reads the user's stored rate first, caches a successful provider result, and never overwrites a stored manual rate.
- User-controlled report and outbound-email HTML is escaped.
- Ordinary record deletion now requires confirmation and shows pending state.
- Destructive reset is disabled unless `ENABLE_DESTRUCTIVE_DATA_RESET=true` is set server-side. Even then, an exact typed phrase is required and current-book reset verifies the selected book ID.
- The default production value in `.env.example` is `false`.

### Performance

- Operational pages request only the datasets they need. A single-module page no longer downloads all income, expenses/receipts, fees, trips/stops/segments, depreciations, reimbursements, and invoices.
- Authentication, settings, and selected-book context are request-locally cached. The cache is not shared between requests/users.
- Module queries, including the optional invoice query, run in one parallel batch.
- Settings no longer loads invoice rows it never renders; its general and invoice settings reads run in parallel.
- Existing exchange rates are reused before an external HTTP request.
- An index-only migration proposes composite indexes for the actual book/date/status query shapes.

This materially reduces database round trips and transferred rows by inspection. No production APM or row-count data was available, so no fabricated latency percentage is claimed. After the Next.js security upgrade, the successful build reports 103 kB shared first-load JavaScript and approximately 112–120 kB on protected UI routes.

### UX

- Income invoice date and expense payment date default to the user's local current date and return to that useful default after reset.
- Expense entry follows the primary flow: date, description, category, amount, currency, receipt. Receipt capture accepts common mobile HEIC/HEIF files.
- Expense lists expose every stored receipt instead of silently showing only the first.
- New-book country selection updates the suggested reporting currency while still allowing an explicit override.

### Tooling and dependency security

- Upgraded from the vulnerable Next.js 14 line to Next.js `15.5.24` maintenance LTS and migrated cookies, route params, and page search params to the supported asynchronous APIs.
- Added a non-interactive ESLint configuration and test command.
- Added seven deterministic accounting tests covering currency direction/rounding, invoice cents/VAT, due dates, private kilometres, same-day meal allowance, depreciation activity, and HTML escaping.
- Updated vulnerable transitive packages and forced Next's compatible PostCSS 8 dependency to the patched `8.5.26`. `npm audit --omit=dev` reports zero vulnerabilities.

## Verified

- `npm test`: 7 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 warnings/errors.
- `npm run build`: passed on Next.js 15.5.24; all 19 routes generated/compiled.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: no whitespace errors.

No authenticated browser smoke test or Supabase integration test was run because that would require using the only production environment. Those checks belong in a separately provisioned staging project or a deliberately authorized, read-only production smoke test.

## Still unsafe or intentionally deferred

1. Trip, draft-invoice, payment, fee, receipt, send/status, and reset workflows still span independent Supabase writes. They need designed, tested, idempotent transaction RPCs.
2. Mixed-currency and multiple partial invoice payments remain unsafe: payment-rate snapshots and invoice-currency equivalents are missing. Restrict use to same-currency invoice/payment/reporting flows until the model is extended.
3. Closed-book immutability is application-enforced, not database-enforced. A direct owner API call can bypass it.
4. Swiss/German mileage and per-diem rules are incomplete, not year/canton/city versioned, and must not be used as authoritative tax advice.
5. Depreciation can still be double-counted with a fully deductible linked expense, and acquisition-year proration/country policy is not modeled.
6. Issued-invoice cancellation deletes linked open accounting rows instead of creating an explicit reversal/audit event.
7. Invoice and general record lists remain unpaginated. Add pagination after production row counts and query plans are measured.
8. Repository `schema.sql` remains behind the migration history; the deployed schema must be exported and compared before any constraint/RPC work.
9. A failed receipt upload leaves the valid expense saved but there is no attach-later repair workflow yet.
10. The deployed duplicate-customer normalizer may mishandle repeated whitespace. It was deliberately excluded from the safe index migration because changing future match behavior requires a live-definition and duplicate preflight review.

## Manual Supabase migration procedure

File: `supabase/migrations/202608290001_safe_query_indexes.sql`

Do not run this as part of application deployment. The exact production procedure is:

1. In Supabase, create/verify a current recoverable backup (and point-in-time recovery if available). Record the backup timestamp.
2. Export the live schema only and confirm all tables named in the migration exist. Do not export or edit row data for this check.
3. Run this read-only preflight in the SQL editor. Stop if any `relation` is null:

```sql
select name, to_regclass('public.' || name) as relation
from unnest(array[
  'incomes',
  'expenses',
  'bank_fees',
  'trips',
  'reimbursements',
  'depreciations',
  'invoices',
  'customers',
  'invoice_payments',
  'receipts'
]) as tables(name);
```

4. During a quiet/off-peak window, paste and run the contents of the migration file once. It contains only `CREATE INDEX IF NOT EXISTS`; it contains no row update/delete, drop, rename, type conversion, or function replacement. Index creation can still use I/O and briefly affect writes.
5. Verify the result with this read-only query:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_incomes_buchhaltung_invoice_date',
    'idx_expenses_buchhaltung_expense_date',
    'idx_bank_fees_buchhaltung_fee_date',
    'idx_trips_buchhaltung_start_at',
    'idx_reimbursements_buchhaltung_date',
    'idx_depreciations_buchhaltung_acquisition_date',
    'idx_invoices_buchhaltung_issue_date',
    'idx_invoices_buchhaltung_status_due_date',
    'idx_customers_buchhaltung_company_name',
    'idx_invoice_payments_buchhaltung_invoice_date',
    'idx_receipts_buchhaltung_expense'
  )
order by indexname;
```

6. Expect exactly 11 rows. If the migration errors, stop and preserve the error; do not replay historical migrations and do not improvise updates/deletes. Review the live schema and query plans before any follow-up.

Keep `ENABLE_DESTRUCTIVE_DATA_RESET` absent or `false` in production.
