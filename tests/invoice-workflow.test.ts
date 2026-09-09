import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { reconcileInvoice, receivedIncomeAmount } from "../src/lib/invoice-accounting";
import type { Invoice, InvoicePayment } from "../src/lib/db-types";
import { readLedgerPages } from "../src/lib/ledger-query";

test("ledger reads include more than 1000 records and fail on an incomplete page", async () => {
  const records = Array.from({ length: 1201 }, (_, id) => ({ id }));
  assert.deepEqual(await readLedgerPages(async (from, to) => ({ data: records.slice(from, to + 1), error: null })), records);
  await assert.rejects(readLedgerPages(async (from, to) => from === 0
    ? { data: records.slice(from, to + 1), error: null }
    : { data: null, error: { message: "network failure" } }), /vollständig/);
});

test("receivables, partial payments, cash dates, fees and legacy reconciliation", () => {
  const v = { id: "invoice", user_id: "u", buchhaltung_id: "ch", currency: "CHF", status: "Ausgestellt", gross_total_cents: 200000, paid_total_cents: 0, payments: [] } as unknown as Invoice;
  assert.equal(reconcileInvoice(v).remainingCents, 200000);
  assert.equal(receivedIncomeAmount({ payment_date: null, payment_received_reporting: 2000 }), 0);
  const payment = { invoice_id: v.id, user_id: "u", buchhaltung_id: "ch", currency: "CHF", request_id: "r", amount_cents: 80000, fee_cents: 0 } as InvoicePayment;
  v.payments = [payment]; v.paid_total_cents = 80000;
  assert.equal(reconcileInvoice(v).status, "Teilweise bezahlt");
  assert.equal(reconcileInvoice(v).remainingCents, 120000);
  v.payments.push({ ...payment, amount_cents: 120000 }); v.paid_total_cents = 200000;
  assert.equal(reconcileInvoice(v).status, "Bezahlt");
  assert.equal(reconcileInvoice(v).receivedCents, 200000);
  assert.equal(receivedIncomeAmount({ payment_date: "2027-01-01", payment_received_reporting: 1200 }, 2026), 0);
  assert.equal(receivedIncomeAmount({ payment_date: "2027-01-01", payment_received_reporting: 1200 }, 2027), 1200);
  v.payments = [{ ...payment, amount_cents: 199000, fee_cents: 1000 }];
  assert.equal(reconcileInvoice(v).receivedCents, 199000);
  assert.equal(reconcileInvoice(v).remainingCents, 0);
  v.status = "Storniert";
  assert.equal(reconcileInvoice(v).remainingCents, 0);
  assert.equal(reconcileInvoice(v).receivedCents, 199000);
  v.payments = [{ ...payment, buchhaltung_id: "de" }];
  assert.equal(reconcileInvoice(v).receivedCents, 0);
  assert.equal(reconcileInvoice(v).legacy, true);
});

test("real PostgreSQL transactions: additive migration, payment pairs, RLS and history", { timeout: 120000 }, async (t) => {
  // Fully isolated WASM PostgreSQL. No Supabase URL, key, network, or production connection.
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1, '/')$$;
    `);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const migrationName = "202609090001_atomic_invoice_payments.sql";
    // The repository's consolidated baseline includes the pre-August fixes.
    await db.exec((await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"))
      .replaceAll('create extension if not exists "pgcrypto";', ""));
    for (const name of files.filter((f) => f >= "202608" && f < migrationName)) {
      const sql = (await readFile(new URL(name, dir), "utf8"))
        .replaceAll('create extension if not exists "pgcrypto";', ""); // gen_random_uuid is built into this PostgreSQL.
      await db.exec(sql);
    }
    const user = randomUUID(), otherUser = randomUUID(), ch = randomUUID(), de = randomUUID(), foreign = randomUUID();
    await db.query("insert into auth.users(id) values ($1),($2)", [user, otherUser]);
    await db.query(`insert into public.buchhaltungen(id,user_id,name,country,reporting_currency,start_date) values
      ($1,$4,'Swiss','Schweiz','CHF','2020-01-01'), ($2,$4,'Germany','Deutschland','EUR','2020-01-01'), ($3,$5,'Other','Schweiz','CHF','2020-01-01')`, [ch, de, foreign, user, otherUser]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    const createInvoice = async (total = 200000, book = ch, currency = "CHF", status = "Ausgestellt") => {
      const id = randomUUID();
      await db.query(`insert into public.invoices(id,user_id,buchhaltung_id,status,issue_date,payment_term,due_date,currency,gross_total_cents,customer_snapshot)
        values($1,$2,$3,$4,'2026-01-01','1 Monat','2026-02-01',$5,$6,'{"company_name":"Test"}')`, [id, book === foreign ? otherUser : user, book, status, currency, total]);
      return id;
    };
    const legacy = await createInvoice();
    const legacyIncome = randomUUID();
    await db.query(`insert into public.incomes(id,user_id,buchhaltung_id,invoice_id,invoice_date,customer_project,category,currency,tax_mode,status,invoice_amount_original,invoice_amount_reporting,reporting_currency)
      values($1,$2,$3,$4,'2026-01-01','Legacy','Rechnung','CHF','BRUTTO','offen',2000,2000,'CHF')`, [legacyIncome, user, ch, legacy]);
    const historicalBefore = (await db.query("select to_jsonb(i) as row from public.incomes i where id=$1", [legacyIncome])).rows;
    const migration = await readFile(new URL(migrationName, dir), "utf8");
    await db.exec(migration);
    await db.exec(migration); // Safe to rerun; no data rewrite, duplicate policies or triggers.
    const historicalAfter = (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(i) as row from public.incomes i where id=$1", [legacyIncome])).rows;
    delete historicalAfter[0].row.invoice_payment_id;
    assert.deepEqual(historicalAfter, historicalBefore);
    await db.exec("grant usage on schema public,auth to authenticated,anon; grant select,insert,update,delete on all tables in schema public to authenticated; grant execute on function auth.uid() to authenticated,anon;");
    const pay = async (invoice: string, amount: number, opts: { request?: string; book?: string; currency?: string; settled?: number; fee?: number; note?: string; over?: boolean; rate?: number; date?: string } = {}) => {
      const result = await db.query<{ id: string }>(`select public.record_invoice_payment_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Test historical',false) as id`,
        [invoice, opts.book ?? ch, opts.request ?? randomUUID(), opts.date ?? "2026-01-05", amount, opts.currency ?? "CHF", opts.settled ?? 0, opts.fee ?? 0, opts.note ?? null, opts.over ?? false, opts.rate ?? 1]);
      return result.rows[0].id;
    };
    const totals = async (invoice: string) => (await db.query<{ payments: number; incomes: number; received: string; paid: number; status: string }>(`select
      (select count(*)::int from public.invoice_payments where invoice_id=v.id) as payments,
      (select count(*)::int from public.incomes where invoice_id=v.id and invoice_payment_id is not null) as incomes,
      (select coalesce(sum(payment_received_original),0)::text from public.incomes where invoice_id=v.id) as received,
      paid_total_cents as paid,status from public.invoices v where id=$1`, [invoice])).rows[0];

    await t.test("issued CHF 2000; CHF 800 + 1200; identical retries create exactly two incomes", async () => {
      const invoice = await createInvoice();
      assert.deepEqual(await totals(invoice), { payments: 0, incomes: 0, received: "0", paid: 0, status: "Ausgestellt" });
      const first = randomUUID(), second = randomUUID();
      await db.exec("set role authenticated");
      const payment = await pay(invoice, 80000, { request: first });
      assert.equal(await pay(invoice, 80000, { request: first }), payment);
      assert.deepEqual(await totals(invoice), { payments: 1, incomes: 1, received: "800.00", paid: 80000, status: "Teilweise bezahlt" });
      await pay(invoice, 120000, { request: second, settled: 80000 });
      await pay(invoice, 120000, { request: second, settled: 80000 });
      assert.deepEqual(await totals(invoice), { payments: 2, incomes: 2, received: "2000.00", paid: 200000, status: "Bezahlt" });
      await assert.rejects(pay(invoice, 70000, { request: first }), /anderen Zahlung/);
      await assert.rejects(db.query("delete from public.invoices where id=$1", [invoice]), /historisch/);
      await db.exec("reset role");
      await assert.rejects(db.query("delete from public.invoice_payments where id=$1", [payment]), /unveränderlich/);
    });

    await t.test("unpaid cancellation retains legacy receivable; paid cancellation blocked", async () => {
      await assert.rejects(db.query("select public.cancel_invoice_v1($1,$2,false)", [legacy, ch]), /bestätigen/);
      await db.query("select public.cancel_invoice_v1($1,$2,true)", [legacy, ch]);
      assert.equal((await totals(legacy)).status, "Storniert");
      assert.equal((await db.query("select id from public.incomes where id=$1", [legacyIncome])).rows.length, 1);
      const invoice = await createInvoice(); await pay(invoice, 80000);
      await assert.rejects(db.query("select public.cancel_invoice_v1($1,$2,true)", [invoice, ch]), /separater buchhalterischer/);
      assert.equal((await totals(invoice)).received, "800.00");
    });

    await t.test("stale balance and double submits; atomic rollback on downstream failure", async () => {
      const invoice = await createInvoice();
      await pay(invoice, 80000);
      await assert.rejects(pay(invoice, 80000), /geändert/);
      const another = await createInvoice();
      await db.exec(`create function public.test_fail_payment() returns trigger language plpgsql as $$begin raise exception 'injected payment failure'; end$$;
        create trigger test_fail before insert on public.invoice_payments for each row execute function public.test_fail_payment();`);
      await assert.rejects(pay(another, 80000), /injected payment failure/);
      assert.deepEqual(await totals(another), { payments: 0, incomes: 0, received: "0", paid: 0, status: "Ausgestellt" });
      await db.exec("drop trigger test_fail on public.invoice_payments; drop function public.test_fail_payment();");
    });

    await t.test("CHF/EUR scope, historic rates, closed books and ownership", async () => {
      const swiss = await createInvoice(100000, ch, "EUR");
      await pay(swiss, 40000, { currency: "EUR", rate: 0.8 });
      await pay(swiss, 60000, { currency: "EUR", rate: 0.9, settled: 40000 });
      const snapshots = await db.query<{ amount_reporting: string; exchange_rate: string }>("select amount_reporting,exchange_rate from public.invoice_payments where invoice_id=$1 order by amount_cents", [swiss]);
      assert.deepEqual(snapshots.rows, [{ amount_reporting: "500.00", exchange_rate: "0.800000" }, { amount_reporting: "666.67", exchange_rate: "0.900000" }]);
      const german = await createInvoice(100000, de, "CHF");
      await pay(german, 100000, { book: de, rate: 0.8 });
      assert.equal((await db.query<{ amount_reporting: string }>("select amount_reporting from public.invoice_payments where invoice_id=$1", [german])).rows[0].amount_reporting, "800.00");
      await assert.rejects(pay(german, 1, { book: ch }), /nicht gefunden/);
      const others = await createInvoice(100000, foreign);
      await db.exec("set role authenticated");
      await assert.rejects(pay(others, 100, { book: foreign }), /nicht gefunden/);
      assert.equal((await db.query("select * from public.invoices where id=$1", [others])).rows.length, 0);
      await db.exec("reset role");
      const closing = await createInvoice(100000, de, "EUR");
      await db.query("update public.buchhaltungen set status='abgeschlossen' where id=$1", [de]);
      await assert.rejects(pay(closing, 100000, { book: de, currency: "EUR" }), /schreibgeschützt/);
    });

    await t.test("fee recorded once, net receipt preserved, overpayment explicit", async () => {
      const invoice = await createInvoice(100000); const request = randomUUID();
      await pay(invoice, 99000, { fee: 1000, note: "Bank fee", request });
      await pay(invoice, 99000, { fee: 1000, note: "Bank fee", request });
      assert.deepEqual(await totals(invoice), { payments: 1, incomes: 1, received: "990.00", paid: 100000, status: "Bezahlt" });
      assert.equal((await db.query("select * from public.bank_fees where invoice_payment_id is not null")).rows.length, 1);
      const over = await createInvoice(100000);
      await assert.rejects(pay(over, 102000), /Überzahlung/);
      await pay(over, 102000, { over: true });
      assert.equal((await totals(over)).received, "1020.00");
      assert.equal((await totals(over)).paid, 102000);
    });

    await t.test("ambiguous legacy payments blocked, direct writes cannot bypass workflow", async () => {
      const invoice = await createInvoice();
      await db.query(`insert into public.invoice_payments(invoice_id,user_id,buchhaltung_id,payment_date,amount_cents,currency) values($1,$2,$3,'2026-01-05',80000,'CHF')`, [invoice, user, ch]);
      await assert.rejects(pay(invoice, 120000), /Historische Zahlungen/);
      await db.exec("set role authenticated");
      await assert.rejects(db.query("update public.invoices set status='Bezahlt' where id=$1", [invoice]), /Rechnungsablauf/);
      await assert.rejects(db.query(`insert into public.invoice_payments(invoice_id,user_id,buchhaltung_id,payment_date,amount_cents,currency) values($1,$2,$3,'2026-01-05',1,'CHF')`, [invoice, user, ch]), /row-level security/);
      await db.exec("reset role");
    });

    await t.test("actual issuance creates no income; historical invoice and items stay fixed", async () => {
      await db.query("insert into public.invoice_settings(user_id,buchhaltung_id) values($1,$2)", [user, ch]);
      const draft = await createInvoice(200000, ch, "CHF", "Entwurf");
      await db.query(`insert into public.invoice_items(invoice_id,user_id,buchhaltung_id,sort_order,title,quantity,unit_price_cents,currency,gross_amount_cents)
        values($1,$2,$3,1,'Test',1,200000,'CHF',200000)`, [draft, user, ch]);
      await db.exec("set role authenticated");
      await db.query("select public.issue_invoice($1)", [draft]);
      assert.deepEqual(await totals(draft), { payments: 0, incomes: 0, received: "0", paid: 0, status: "Ausgestellt" });
      await assert.rejects(db.query("update public.invoices set gross_total_cents=1 where id=$1", [draft]), /unveränderlich/);
      await assert.rejects(db.query("delete from public.invoice_items where invoice_id=$1", [draft]), /unveränderlich/);
      await assert.rejects(pay(draft, 100, { currency: "EUR" }), /ungültig/);
      await assert.rejects(pay(draft, -1), /ungültig/);
      await assert.rejects(pay(draft, 100, { fee: -1 }), /ungültig/);
      await assert.rejects(pay(draft, 100, { fee: 100 }), /Begründung/);
      await assert.rejects(pay(draft, 100, { date: "2019-01-01" }), /ungültig/);
      await db.exec("reset role");
    });

    await t.test("deferred relation rejects orphan income; managed income and fee cannot be removed", async () => {
      const invoice = await createInvoice();
      await assert.rejects(db.query(`insert into public.incomes(user_id,buchhaltung_id,invoice_id,invoice_payment_id,
        invoice_date,payment_date,customer_project,category,currency,tax_mode,status,reporting_currency)
        values($1,$2,$3,$4,'2026-01-01','2026-01-05','Orphan','Rechnung','CHF','BRUTTO','bezahlt','CHF')`, [user, ch, invoice, randomUUID()]), /gemeinsam/);
      assert.equal((await totals(invoice)).incomes, 0);
      const payment = await pay(invoice, 199000, { fee: 1000, note: "Fee" });
      await assert.rejects(db.query("delete from public.incomes where invoice_payment_id=$1", [payment]), /unveränderlich/);
      await assert.rejects(db.query("delete from public.bank_fees where invoice_payment_id=$1", [payment]), /unveränderlich/);
      await db.exec("set role authenticated");
      await db.query("update public.incomes set payment_received_original=1 where invoice_payment_id=$1", [payment]);
      await db.query("delete from public.incomes where invoice_payment_id=$1", [payment]);
      assert.equal((await totals(invoice)).received, "1990.00");
      await db.exec("reset role; set role anon");
      await assert.rejects(pay(invoice, 1), /permission denied/);
      await db.exec("reset role");
    });

    await t.test("an unambiguous legacy open income is retained beside the new payment income", async () => {
      const invoice = await createInvoice();
      const historical = randomUUID();
      await db.query(`insert into public.incomes(id,user_id,buchhaltung_id,invoice_id,invoice_date,customer_project,category,currency,tax_mode,status,reporting_currency)
        values($1,$2,$3,$4,'2026-01-01','Old receivable','Rechnung','CHF','BRUTTO','offen','CHF')`, [historical, user, ch, invoice]);
      const before = (await db.query("select * from public.incomes where id=$1", [historical])).rows;
      await pay(invoice, 80000);
      assert.deepEqual((await db.query("select * from public.incomes where id=$1", [historical])).rows, before);
      assert.equal((await totals(invoice)).received, "800.00");
      assert.equal((await totals(invoice)).incomes, 1);
    });
  } finally { await db.close(); }
});
