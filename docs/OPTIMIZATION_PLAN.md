# Safe Optimization Plan

This plan assumes the live Supabase project is the sole authoritative production database. No migration in this repository will be executed automatically. No historical financial value or issued-invoice snapshot will be rewritten.

## A. Safe code-only improvements

1. Add request-local caching for authentication and the selected bookkeeping context. Do not use a shared persistent cache for user data.
2. Make `getModuleData()` accept an explicit dataset list and fetch invoices in the same parallel batch. Add `user_id` filters as defense in depth.
3. Use the active book’s reporting currency as the operational input default (Swiss = CHF, German = EUR), while preserving all stored row currencies.
4. Correct future-only pure calculation defects with tests:
   - exclude private segments from kilometre deduction;
   - require more than eight hours for a same-day German per-diem amount;
   - clamp one-month invoice due dates to the target calendar month;
   - include still-active prior-year depreciation in selected-year reporting without rewriting stored rows.
5. Require authentication and date validation on exchange-rate lookup; read/write the existing `exchange_rates` cache before calling the provider. Never overwrite a stored manual rate automatically.
6. Validate receipt MIME type and file size before writing the expense. Keep receipt metadata authoritative.
7. Add confirmation/pending state for ordinary record deletion.
8. Environment-gate destructive reset and require typed, server-validated confirmation. Keep the code path available for deliberately enabled non-production/admin use.
9. Move expense category and receipt into the primary form and default income/expense dates to today.
10. Make new-book country/reporting-currency controls stay synchronized, without hardcoding a database ID.
11. Add a safe guard against changing an active book’s country/reporting currency after financial history exists. If history cannot be checked, reject the change rather than relabel amounts.
12. Escape dynamic yearly-report/email HTML and add actionable German errors where a safe recovery action is known.

## B. Safe additive database migrations

### SAFE — create only, run manually

- Add composite indexes matching book/date/status filters. These do not change row values. Index creation can still take locks/resources, so run off-peak after a backup.

### SAFE only after read-only compatibility checks

- Add a partial unique default-bank index after verifying there is at most one default per `(buchhaltung_id, currency)`.
- Add a unique normalized-customer index after listing and manually resolving/accepting existing duplicates. Do not auto-merge customers.
- Replace the duplicate-customer normalization function only after reading its deployed definition and running read-only comparison/duplicate checks. This changes future comparison behavior and therefore is not part of the index-only migration.
- Add invoice-payment snapshot columns (`exchange_rate`, source/manual flag, reporting amount, invoice-currency equivalent, idempotency key). Adding nullable columns is safe; populating historical rows is a separate manual accounting decision.

### Not included in the initial safe migration

- Closed-book write-blocking triggers: desirable, but must be tested against invoice/payment/reopen/admin workflows first.
- Transactional RPCs for trip persistence, invoice draft persistence, payment recording, and invoice send state: additive functions are possible, but deploying application calls before the function exists would break production. Design and stage them in a separate release.

## C. UX improvements

1. Keep the selected bookkeeping in the existing secure cookie and prefer the most recently selected/active book; never hardcode IDs.
2. Show the active book and its CHF/EUR reporting context prominently; preserve closed German data as view/export-only.
3. Primary expense order: date, description, category, amount, currency, receipt. Put reimbursement, deductibility, manual-rate, depreciation, and notes behind “Weitere Optionen”.
4. Keep today as the date after a successful rapid-entry save, while clearing record-specific text and amounts.
5. Keep trip structure as start → stops → endpoint, with meal and reimbursement details progressively disclosed.
6. Keep sender/bank/numbering configuration in Settings. Invoice creation should focus on recipient, items, payment term, tax choice, preview, and issue/send.
7. Add customer search/autocomplete and an attach-missing-receipt recovery workflow in a later focused iteration.
8. Replace ambiguous errors with German recovery instructions and preserve form values on failures that did not commit a financial row.

## D. Performance improvements

1. Eliminate all-module fetches on single-module pages.
2. Dedupe auth/settings/book reads within a request.
3. Query invoice/settings/bank/customer data selectively on Settings; do not load invoices there.
4. Read Supabase exchange-rate cache first; cache successful provider results once per user/date/pair.
5. Add composite indexes for common book/date/status ordering.
6. Add pagination for invoices and high-volume record lists after measuring production row counts.
7. Add route loading/error boundaries and avoid redundant `router.refresh()` where revalidation already supplies authoritative data.
8. Keep optimistic feedback limited to UI pending state; show financial success only after Supabase confirms the authoritative write.

## E. Improvements requiring future manual review

1. **UNSAFE — historical travel recalculation.** Do not rewrite existing mileage/per-diem amounts. Select the Swiss canton/method and versioned German/Swiss rule sets first; apply only to new calculations unless each historical change is explicitly approved.
2. **UNSAFE — historical depreciation recalculation.** Do not mass-update stored yearly/deducted/remaining values. Establish country-specific policy, proration, immediate-expense rules, and an audit export first.
3. **UNSAFE — historical invoice/payment conversion backfill.** Missing payment-date rates cannot be inferred safely for partial/mixed-currency payments without source documents.
4. **UNSAFE — changing existing book country/reporting currency.** Relabelling stored reporting values is not conversion. Create a new book or use a reviewed migration with reconciled opening balances.
5. **UNSAFE — merging/deleting duplicate customers.** Preserve invoice snapshots and choose canonical records manually.
6. **UNSAFE — cancellation by deleting receivables.** Replace with reversal/audit records only after the intended German/Swiss accounting treatment is approved.
7. **Manual infrastructure review.** Export live schema/policies/indexes, verify backups and point-in-time recovery, confirm private bucket settings, disable public sign-up if this is a private deployment, and review production environment secrets.

# Initial implementation scope

The first implementation will deliberately stay small:

- request/query reduction;
- bookkeeping-specific default currency;
- rapid-entry date/category/receipt improvements;
- future-only pure calculation fixes with tests;
- authenticated database-backed exchange-rate cache;
- delete/reset safeguards;
- server-side receipt validation;
- additive, index-only migration file (created but not executed);
- verification via lint, TypeScript, tests, and production build.

Atomic financial RPCs, Swiss tax-rule changes, historical backfills, issued-invoice mutation, and live database execution are excluded from this pass.
