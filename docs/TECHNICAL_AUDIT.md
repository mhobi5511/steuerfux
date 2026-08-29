# Executive Summary

At the start of the audit, the application was a compact, feature-rich Next.js 14 accounting MVP with a sound initial security idea: authenticated Supabase access, private storage buckets, a top-level `buchhaltungen` table, composite `(buchhaltung_id, user_id)` foreign keys on most financial relations, and immutable invoice snapshots for recipient, sender, bank, tax, and totals. The production build and strict TypeScript check passed at that baseline.

The strongest parts are the explicit bookkeeping context, server-side authentication, per-user RLS, private receipt/invoice storage, per-book invoice settings and numbering, integer-cent invoice totals, and the application-level read-only state for closed books.

The largest risks are accounting writes spread over several independent Supabase calls, tax logic shared between Germany and Switzerland, cross-currency invoice/payment calculations that lose the historical rate context, a destructive reset path, and repository schema drift. Several actions return success even when a dependent write failed. These are data-integrity risks, not cosmetic code-quality concerns.

The largest UX bottlenecks are the receipt field being hidden behind “Mehr Optionen”, no default date on the main income/expense forms, no confirmation on ordinary delete buttons, a long invoice form without a compact customer search, and the bookkeeping selector mixing daily workspace selection with create/close/reopen administration.

The largest performance bottleneck is `getModuleData()`: most operational pages fetch all yearly incomes, expenses with receipts, fees, trips with all stops/segments, depreciations, reimbursements, and invoices even when the page needs only one table. The protected layout and page also repeat authentication, settings, and bookkeeping-context reads. Invoice lists are unbounded and fetch every nested item/payment.

The largest maintainability problem is concentration of business logic in two server-action files (`finance.ts` and `invoices.ts`) with repeated context resolution, conversion logic, trip persistence, and multi-write workflows. There is no automated test suite, the lint command is not configured non-interactively, and `supabase/schema.sql` no longer represents the later bookkeeping, receipt, and invoice migrations.

This audit did not connect to Supabase and did not inspect or change production rows. Findings about deployed constraints, indexes, policies, and data compatibility must be confirmed in the Supabase dashboard before running any new SQL.

# Critical Issues

## 1. Multi-step financial writes are not atomic

- Draft invoice updates delete all `invoice_items` and then insert replacements. The insert error is ignored. A transient failure can leave a draft with totals but no items.
- Trip edits update the parent, delete every stop and segment, then recreate them. Child insert errors are ignored. A failure can permanently remove the previous route details.
- Invoice payment recording updates/inserts income, inserts a payment, updates the invoice, and upserts a fee as separate operations. Errors after the income write are ignored, so invoice, income, payment, and fee state can disagree.
- Expense creation, depreciation creation, receipt storage, receipt metadata, and receipt flags are independent. Partial success is reported ambiguously.
- Sending email occurs before receivable/status persistence. A retry after an accounting write failure can send the invoice twice.

These workflows should ultimately be transactional database functions with idempotency keys. They should not be cosmetically refactored client-side.

## 2. German and Swiss travel accounting logic is mixed

`src/lib/trips.ts` uses a global `0.30` per-kilometre amount for both businesses. `src/lib/per-diem.ts` embeds a small German-style table and returns those amounts directly in the selected book’s reporting currency. A Swiss book therefore labels German-model amounts as CHF without a conversion or Swiss rule set.

The table is not year-versioned and is already inconsistent with the official German 2026 foreign-travel table. For example, the code contains Switzerland `64/43`, while the BMF 2026 table distinguishes Bern (`82/55`) and Geneva/other Switzerland (`70/47`) in EUR. The official rules also distinguish the last place reached before midnight and the last foreign place of work. See the [BMF 2026 travel-cost guidance](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2025-12-05-steuerliche-behandlung-reisekosten-2026.pdf?__blob=publicationFile&v=5).

Swiss business travel is not safely represented by reusing the German table. Current Swiss guidance uses different concepts and amounts; for example, the Swiss tax conference’s 2026 model expense regulations describe effective meal costs or CHF meal allowances, while vehicle treatment can depend on facts and cantonal practice. See the [Swiss 2026 model expense regulations](https://www.estv.admin.ch/dam/de/sd-web/AVMEjJmvl5AD/dbst-form-lohna-spesenreglement-2026-de.pdf) and the [Zurich 2026 vehicle guidance](https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender/steuerbuch/steuerbuch-definition/zstb-17-1.html).

No new Swiss tax amount should be hardcoded until the user’s canton, vehicle treatment, and accepted accounting method are confirmed.

## 3. Cross-currency invoice receivables and payments can be wrong

- `ensureOpenIncomeForInvoice()` converts with rate `1`, even when invoice currency differs from reporting currency.
- `recordInvoicePayment()` adds payment cents to invoice cents even though the UI allows payment currency to differ from invoice currency.
- The linked income stores `currency` from the payment but `invoice_amount_original` from the invoice, so the two amounts can describe different currencies in one row.
- For multiple partial payments, the latest exchange rate is applied to the cumulative received amount. Earlier payment-date rates are lost.
- `invoice_payments` does not store an exchange-rate snapshot, reporting amount, or invoice-currency equivalent.
- A unique `(related_income_id, fee_type)` bank-fee rule collapses multiple payment fees for the same invoice income into one row.

This is safe for the narrow same-currency case (CHF invoice/payment/reporting in the Swiss book, or EUR throughout the German book), but not for mixed-currency or multi-payment cases. Historical payment rows must not be rewritten automatically.

## 4. Closed books are read-only only in the application

The UI and server actions call `assertWritableBuchhaltung()`, which is useful. The database policies, however, allow an authenticated owner to insert/update/delete rows in a closed book through the Supabase API. Storage policies also do not check book status. The German bookkeeping is therefore not database-enforced read-only.

A database trigger/policy design should be added only after testing all legitimate status, invoice-payment, and administrative transitions. Reopening a book must remain an explicit operation.

## 5. Depreciation reporting is incomplete and can double count

`getModuleData()` currently filters depreciations by `acquisition_date` inside the report year. Assets acquired in earlier years disappear even while their useful life continues. Separately, a depreciable expense can remain 100% deductible while its generated depreciation is also added to costs, creating a double-counting risk. The model also applies a full annual amount in the acquisition year and stores a summary based on the year in which the record was saved rather than deriving the selected report year.

Historical values should not be mass-recalculated. Future reporting should derive the applicable year from the original acquisition value/date/life and clearly prevent or flag simultaneous immediate deduction and depreciation.

## 6. Destructive operations have insufficient safeguards

- Settings exposes deletion of the current book and all books. The all-data action deletes financial rows, storage objects, exchange rates, book contexts, and resets settings through non-transactional calls.
- Ordinary record delete buttons have no confirmation.
- Cancelling an issued/sent invoice deletes its linked open income and fees instead of preserving a reversal/audit trail.
- Deleting a bookkeeping row cascades through most financial tables by foreign key.

No destructive operation was executed during this audit. Production reset should be environment-gated and require typed confirmation. Issued-document cancellation needs an explicit accounting/audit design rather than silent deletion of linked history.

## 7. Deployed schema state cannot be reconstructed reliably from the repository

`supabase/schema.sql` stops at the pre-`buchhaltungen` model. Later tables and policies exist only in migrations. Historical “fix” SQL files add many nullable compatibility columns. Earlier migrations contain data updates, deletes, constraint drops, and backfills and are not safe to replay casually against the only production database.

Before any future constraint or transaction RPC is deployed, export the live schema (not row data), compare it with the migration history, and take a verified Supabase backup.

# High Priority Improvements

- Make module reads selective so an expense page does not fetch invoices, trips, income, fees, reimbursements, and depreciation.
- Deduplicate per-request authentication/settings/book-context reads with request-local React caching; do not use cross-user persistent caching.
- Query and persist cached historical CHF/EUR rates before calling the remote provider again. Keep manual overrides immutable.
- Validate receipt MIME type and size on the server before the financial insert; do not trust the HTML `accept` attribute.
- Move category and receipt into the main expense workflow and default the relevant date to today.
- Default input currency from the selected book (CHF for Switzerland, EUR for Germany), not from a single global preference inherited from the other business.
- Add confirmation and pending state to record deletion; gate production reset behind an explicit environment flag and typed phrase.
- Fix unambiguous pure-calculation bugs for future rows: private trip segments must not create a business kilometre deduction, same-day trips of eight hours or less must not receive the German arrival/departure allowance, and “one month” invoice due dates must clamp to the target month.
- Add additive composite indexes matching the actual `buchhaltung_id + date/status` query shapes.
- Add targeted tests for currency direction, invoice cents/totals/due dates, business-only kilometres, per-diem edge cases, and depreciation-year activity.
- Add actionable German error messages and check every dependent Supabase response.

# Medium Priority Improvements

- Split action modules by bounded workflow (context, income, expense/receipt, travel, invoice, settings) after transaction boundaries are designed.
- Add pagination or date-windowed queries to invoice and record lists.
- Add `loading.tsx` and route-level `error.tsx` boundaries for perceived performance and safer failures.
- Add customer autocomplete/search rather than a large select, and lazy-load customer/invoice detail.
- Add an explicit “attach missing receipt” workflow so a storage failure does not require creating a duplicate expense.
- Move bookkeeping creation/close/reopen administration out of the always-visible daily selector.
- Escape all dynamic HTML in the yearly report and outbound email body.
- Protect the exchange-rate endpoint with authentication and input validation; add conservative cache headers/rate limiting at deployment.
- Generate Supabase TypeScript types from the verified live schema instead of maintaining broad hand-written types and `Record<string, unknown>` casts.
- Add a backup/runbook document covering live-schema export, migration dry run, rollback, and post-migration verification.

# Low Priority / Nice-to-have

- Add list virtualization only if real row counts justify it; pagination is preferable first.
- Add keyboard focus management after successful save and after opening/closing mobile dialogs.
- Add inline customer/project suggestions from the current book only.
- Add route prefetching for the most common next entry workflow.
- Improve mobile invoice item editing and preview layout.
- Replace index-based React table keys with stable record IDs where practical.
- Add structured application logging with request/action identifiers and redaction.

# Unnecessary Complexity

- `createTrip()` and `upsertTrip()` duplicate almost the same persistence and calculation logic; only `upsertTrip()` is used by the form.
- `lookupExchangeRate()` server action and the public exchange-rate route duplicate lookup behavior; neither currently reads the database cache first.
- `createSupabaseBrowserClient()`, `describeExchangeRate()`, and `deleteBankFee()` appear unused. They should not be removed until runtime usage is confirmed.
- `date-fns` and `date-fns-tz` are declared but no source import was found. Dependency removal should wait for a full production/runtime check.
- Global settings duplicate country/reporting-currency concepts now owned by the active bookkeeping. Changing them also updates the active book, which can relabel existing amounts without conversion.
- Stored depreciation summaries duplicate values derivable from acquisition data and become stale across report years.
- Both HTML and React-PDF invoice renderers implement overlapping layout/content rules. This is maintainable only if snapshot and calculation tests protect parity.
- Customers are managed both while creating an invoice and in settings. That is useful, but the full customer administration should not inflate the daily invoice workflow.
- The dashboard includes synthetic “helper samples” unrelated to actual rows; they add query/render work and can confuse operational meaning.

Nothing in this section was deleted during the audit.

# Performance Audit

## Slow page changes and form loading

- Protected navigation performs authentication/context work in both layout and page.
- `getModuleData()` performs settings/context reads, six parallel table queries, then a seventh invoice query in a waterfall.
- Every module page uses this full loader even if it needs only one dataset.
- Trips pull all nested stops/segments and expenses pull all receipts.
- Invoice pages pull all invoices with all items/payments, plus all customers, settings, and bank accounts, without limits.
- Settings loads general settings and then the full invoice module sequentially, including invoices it never renders.

## Slow saves and unnecessary refreshes

- Every action resolves auth, settings, and all books before writing.
- Multi-step writes create several sequential network round trips.
- Client forms call `router.refresh()` after some actions even though server actions also call `revalidatePath()`.
- Broad revalidation touches several routes after one write; it is safer than stale financial UI but can be targeted more precisely.

## Exchange-rate requests

- The route calls Frankfurter/ECB on each application request (Next’s fetch cache may help per deployment, but the Supabase `exchange_rates` table is not consulted).
- Rates are written to `exchange_rates` only during some saves and errors are ignored.
- Invoice payments always label the rate manual and never reuse the stored cache.

## Client rendering and bundles

- The production build is currently modest: protected pages are roughly 97–111 kB first-load JavaScript.
- Large client components (`trip-form.tsx`, `invoice-module.tsx`, `expense-form.tsx`) rerender broad trees for every field change.
- Invoice position editing and trip stop/segment editing are suitable candidates for component extraction/memoization only after correctness work.
- PDF/QR libraries are server-route dependencies in the current architecture and do not materially inflate the listed page bundles.

# UX Audit

## Income

From the income page, a normal unpaid entry currently requires invoice date, customer/project, amount, and save; currency is preselected. The date is blank, so the user must choose it every time. A paid entry additionally needs payment date and optionally received amount. Cross-currency entry requires opening/loading a rate manually. Successful new saves reset the form, but they also clear the date instead of retaining a useful today default.

## Expense

A basic expense requires payment date, description, amount, and save. Category and receipt are hidden behind “Mehr Optionen”, adding a disclosure click before the file/camera action. This contradicts the intended primary workflow. Mobile capture is enabled, which is good, but server MIME/size validation is missing. Successful saves reset the form; a partial receipt failure can reset the form even though the receipt was not stored and there is no attach-later workflow.

## Trip

The route structure is understandable: start, stops, endpoint, then kilometres. Labels are generally beginner-friendly. Each stop requires location, country, arrival, departure, and purpose, with meal reductions behind a disclosure. The main issue is trust: calculated amounts look authoritative even though country/year/business rules are incomplete. Distance must be calculated per segment. Successful new saves reset useful home-address defaults.

## Invoice creation

Starting from the list requires “Neue Rechnung”; the creation form then exposes recipient, address details, issue/payment data, tax, bank/QR settings, positions, and notes on one page. Selecting a saved customer fills the address, but there is no autocomplete for a large customer list. Sender settings are correctly outside invoice creation. Default payment term is already read from per-book invoice settings and falls back to one month.

Issuing is a separate action after saving the draft, which is appropriate for historical immutability. Sending opens another disclosure form. The current email says the PDF is available in the app but does not attach it, so an external recipient cannot access it.

## Marking an invoice paid

The list disclosure defaults amount and date, which is efficient. It exposes currency and a raw exchange-rate field even for same-currency payments, and it does not load the historical rate. The workflow appears simple but is unsafe for mixed-currency or multiple partial payments until the data model is extended.

## Receipt viewing/deletion

Receipt viewing uses a short-lived signed URL from a private bucket. Lists show only the first receipt even though the schema allows more. Ordinary financial delete buttons perform immediately with no confirmation or undo.

# Database Audit

## Tables represented in migrations/code

`settings`, `exchange_rates`, `buchhaltungen`, `incomes`, `expenses`, `bank_fees`, `reimbursements`, `trips`, `trip_stops`, `trip_segments`, `depreciations`, `receipts`, `customers`, `invoice_settings`, `bank_accounts`, `invoices`, `invoice_items`, and `invoice_payments`.

Storage buckets represented are private `receipts` and private `invoice-assets`.

## Separation and relations

- Most financial tables have non-null `buchhaltung_id` after the 2026-08-12 migration and composite FKs back to `(buchhaltungen.id, user_id)`. This is the strongest protection against cross-user/context insertion.
- Customers, bank accounts, invoice settings, invoices, items, and payments are book-scoped.
- Exchange rates and general settings are user-scoped rather than book-scoped. Shared objective rates are reasonable; global defaults are not sufficient for business-specific address/currency preferences.
- Cascade delete from `buchhaltungen` is operationally dangerous with the current reset UI.
- Closed status is not referenced by child-table policies/triggers.

## RLS and storage

- RLS is enabled for represented application tables and checks `auth.uid() = user_id`.
- Child-table RLS does not itself verify `buchhaltung_id`, but composite foreign keys prevent pairing the user with another user’s book.
- Policies permit all write operations for the owner regardless of closed status.
- Storage policies constrain the first path segment to the authenticated user and both buckets are private.
- Registration appears publicly available if Supabase Auth permits sign-up. RLS contains accounts, but a private single-user deployment should disable sign-up after provisioning.

## Indexes

Single-column book and date indexes exist, but the common query shapes combine book with date/status. Useful additive candidates are:

- `(buchhaltung_id, invoice_date desc)` on incomes
- `(buchhaltung_id, expense_date desc)` on expenses
- `(buchhaltung_id, fee_date desc)` on bank fees
- `(buchhaltung_id, start_at desc)` on trips
- `(buchhaltung_id, reimbursement_date desc)` on reimbursements
- `(buchhaltung_id, acquisition_date desc)` on depreciations
- `(buchhaltung_id, issue_date desc)` and `(buchhaltung_id, status, due_date)` on invoices
- `(buchhaltung_id, company_name)` on customers
- `(buchhaltung_id, invoice_id, payment_date desc)` on invoice payments

Do not remove existing indexes until live usage statistics are reviewed.

## Nullable/crash and schema-drift risks

- Hand-written TypeScript types assume several fields are non-null even though compatibility SQL added nullable columns.
- `normalizeIncomeStatus()` treats every unknown/null value as paid, which is a dangerous fallback for legacy drift.
- JSON invoice snapshots are broadly cast and only partially guarded.
- `supabase/schema.sql` omits all later book/receipt/invoice structures.
- The SQL customer normalizer appears to use a double-backslash whitespace regex, so repeated whitespace may not normalize as intended.
- Trigger-only duplicate-customer prevention is subject to concurrent insert races; a unique functional index can be added only after a read-only duplicate audit.
- Only one default bank account per book/currency is intended in code but is not enforced by a compatible partial unique index.

## Migration safety assessment

Historical migrations include mass `UPDATE`, `DELETE`, constraint drops, and `SET NOT NULL`. They may have been necessary at the time but are not safe templates for the only production database. New work must be additive and manually executed only after live-schema and duplicate/null preflight checks.
