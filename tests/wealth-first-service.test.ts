import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  calculateWealthFirstDistribution,
  distributionDateForMonth,
  isDistributionDate,
  parseChfToCents,
  WEALTH_FIRST_DEFAULT_TARGETS
} from "../src/lib/wealth-first";

const targets = WEALTH_FIRST_DEFAULT_TARGETS.map((pot, index) => ({
  ...pot, potId: String(index), sortOrder: index, alreadyAllocatedCents: 0
}));
const calculate = (balance: number, pots = targets, buffer = 0, tax = 0) =>
  calculateWealthFirstDistribution({ bankBalanceCents: balance, previousBufferCents: buffer,
    taxRateBasisPoints: tax, bufferTargetCents: 450_000, pots });

test("Servicekonto first, CHF 2'285 default total and partial goals without negative buffer", () => {
  assert.equal(targets.reduce((sum, pot) => sum + pot.monthlyTargetCents, 0), 228_500);
  const tiny = calculate(3_000, [...targets].reverse());
  assert.equal(tiny.pots[0].destinationType, "service_account");
  assert.deepEqual(tiny.pots.map((pot) => pot.allocationCents), [3_000, 0, 0, 0, 0]);
  const partial = calculate(223_812);
  assert.deepEqual(partial.pots.map((pot) => pot.allocationCents), [4_000, 62_000, 45_000, 75_000, 37_812]);
  assert.equal(partial.pots[4].remainingAfterCents, 4_688);
  assert.equal(partial.resultingBufferCents, 0);
  const second = calculate(10_000, targets.map((pot, i) => ({ ...pot, alreadyAllocatedCents: partial.pots[i].allocationCents })));
  assert.deepEqual(second.pots.map((pot) => pot.allocationCents), [0, 0, 0, 0, 4_688]);
  assert.equal(second.resultingBufferCents, 5_312);
});

test("manual reductions recalculate downstream; invalid overrides block with nonnegative preview", () => {
  const reduced = calculate(10_000, targets.map((pot, i) => i === 0 ? { ...pot, allocationCents: 1_000 } : pot));
  assert.deepEqual(reduced.pots.map((pot) => pot.allocationCents), [1_000, 9_000, 0, 0, 0]);
  assert.equal(reduced.validationErrors.length, 0);
  const invalid = calculate(3_000, targets.map((pot, i) => i === 0 ? { ...pot, allocationCents: 4_000 } : pot));
  assert.ok(invalid.validationErrors.length);
  assert.equal(invalid.resultingBufferCents, 0);
});

test("integer centime reconciliation across funds, tax rates and saved buffers; warning is nonblocking", () => {
  for (const buffer of [0, 1, 100_000, 450_000]) {
    for (const receipts of [0, 1, 2, 103, 266_116, 1_000_001]) {
      for (const tax of [0, 2500, 3333, 10000]) {
        const result = calculate(buffer + receipts, targets, buffer, tax);
        assert.equal(result.reconciles, true);
        assert.ok(result.resultingBufferCents >= 0);
        assert.equal(result.validationErrors.length, 0);
        assert.equal(result.taxReserveCents + result.allocationTotalCents + result.surplusTransferCents + result.pendingSurplusCents + result.resultingBufferCents, buffer + receipts);
      }
    }
  }
  const saved = calculate(228_500, targets, 228_500, 2500);
  assert.equal(saved.taxReserveCents, 0);
  assert.equal(saved.resultingBufferCents, 0);
  assert.equal(saved.bufferBelowTarget, true);
});

test("10th, 25th and custom actual dates validate independently of funding month", () => {
  assert.equal(distributionDateForMonth("2026-11", "10"), "2026-11-10");
  assert.equal(distributionDateForMonth("2027-01", "25"), "2027-01-25");
  assert.equal(distributionDateForMonth("", "10"), "");
  assert.equal(isDistributionDate("2028-02-29"), true);
  assert.equal(isDistributionDate("2026-02-29"), false);
  assert.equal(isDistributionDate("2026-11-31"), false);
  assert.equal(isDistributionDate("2026-12-03"), true);
  assert.equal(parseChfToCents("90'071'992'547'409.91"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseChfToCents("90'071'992'547'409.92"), null);
});

test("isolated PostgreSQL v2: additive upgrade, server priority, dates, snapshots and transaction safety", { timeout: 120_000 }, async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.buchhaltungen(id uuid primary key,user_id uuid not null references auth.users(id),name text,
        country text,reporting_currency text,status text,unique(id,user_id));
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now(); return new; end$$;
      create table public.accounting_sentinel(id integer primary key, original_data jsonb);
      insert into public.accounting_sentinel values(1,'{"invoice":99,"income":123.45,"expense":40,"tax":31}');`);
    const base = await readFile(new URL("../supabase/migrations/202610260001_wealth_first.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../supabase/migrations/202611100001_wealth_first_service_dates.sql", import.meta.url), "utf8");
    await db.exec(base);
    const user = randomUUID(), other = randomUUID(), book = randomUUID(), german = randomUUID();
    const ids = targets.map(() => randomUUID());
    const pots = targets.map((pot, i) => ({ id: ids[i], name: pot.name, monthly_target_cents: pot.monthlyTargetCents,
      active: true, sort_order: i, destination_type: pot.destinationType }));
    await db.query("insert into auth.users values($1),($2)", [user, other]);
    await db.query("insert into public.buchhaltungen values($1,$3,'CH','Schweiz','CHF','aktiv'),($2,$3,'DE','Deutschland','EUR','aktiv')", [book, german, user]);
    await db.exec("grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    await db.query("select public.save_wealth_first_settings_v1($1,null,0,450000,0,$2::jsonb)", [book, JSON.stringify(pots)]);
    await db.query("select public.confirm_wealth_first_distribution_v1($1,$2,'2099-09-01',4000,0,1,$3::jsonb)",
      [book, randomUUID(), JSON.stringify(ids.map((id, i) => ({ pot_id: id, allocation_cents: i === 0 ? 4000 : 0 })))]);
    const legacyDistribution = (await db.query("select to_jsonb(d) data from public.wealth_first_distributions d")).rows;
    const legacyAllocations = (await db.query("select to_jsonb(a) data from public.wealth_first_distribution_allocations a order by id")).rows;
    await db.exec("reset role");
    const accounting = (await db.query("select * from public.accounting_sentinel")).rows;
    await db.exec(migration);
    await db.exec(migration); // Also safe on an already populated schema.
    assert.deepEqual((await db.query("select to_jsonb(d)-'distribution_date' data from public.wealth_first_distributions d")).rows, legacyDistribution);
    assert.deepEqual((await db.query("select to_jsonb(a)-'destination_type_snapshot'-'manual_override_snapshot' data from public.wealth_first_distribution_allocations a order by id")).rows, legacyAllocations);
    await db.exec("set role authenticated");
    const state = async () => {
      const row = (await db.query<{ version: string; current_buffer_cents: string }>("select version,current_buffer_cents from public.wealth_first_settings where buchhaltung_id=$1", [book])).rows[0];
      return { version: Number(row.version), buffer: Number(row.current_buffer_cents) };
    };
    const save = async (items = pots) => db.query("select public.save_wealth_first_settings_v2($1,$2,0,450000,null,$3::jsonb)", [book, (await state()).version, JSON.stringify(items)]);
    const confirm = async (options: { key?: string; date?: string; month?: string; balance?: number;
      amounts?: number[]; manual?: boolean[]; expected?: { version: number; buffer: number } } = {}) => {
      const expected = options.expected ?? await state();
      const result = await db.query<{ id: string }>("select public.confirm_wealth_first_distribution_v2($1,$2,$3,$4,$5,$6,$7,$8::jsonb) id",
        [book, options.key ?? randomUUID(), options.month ?? "2099-10-01", options.date ?? "2099-10-10", options.balance ?? 223_812,
          expected.buffer, expected.version, JSON.stringify(ids.map((id, i) => ({ pot_id: id,
            allocation_cents: options.amounts?.[i] ?? [4000,62000,45000,75000,37812][i], manual_override: options.manual?.[i] ?? false })).reverse())]);
      return result.rows[0].id;
    };

    await t.test("explicit existing Servicekonto mapping initializes once; repeated setup and settings preserve history", async () => {
      await save();
      await save();
      assert.equal((await db.query("select * from public.wealth_first_pots")).rows.length, 5);
      assert.equal((await db.query("select * from public.wealth_first_pots where destination_type='service_account'")).rows.length, 1);
      await assert.rejects(save(pots.map((pot, i) => i === 1 ? { ...pot, destination_type: "service_account" } : pot)), /Genau ein Servicekonto/);
      await assert.rejects(save(pots.map((pot, i) => ({ ...pot, destination_type: i === 1 ? "service_account" : "private_pot" }))), /bestehende Servicekonto/);
      await assert.rejects(save(pots.map((pot, i) => i === 0 ? { ...pot, active: false } : pot)), /aktiv bleiben/);
      await assert.rejects(confirm({ date: "0001-01-01", balance: 0, amounts: [0,0,0,0,0] }), /liegt vor/);
      // Mapping reuses the legacy ID: its already funded CHF 40 is not transferred again.
      await confirm({ date: "2099-09-10", month: "2099-09-01", balance: 1000, amounts: [0,1000,0,0,0] });
      await assert.rejects(db.query("select public.confirm_wealth_first_distribution_v1($1,$2,'2099-10-01',0,0,1,'[]')", [book, randomUUID()]), /permission denied/);
    });

    let firstId: string;
    await t.test("partial allocation, warning, date and classification snapshots; double-click and retry are idempotent", async () => {
      const expected = await state(), key = randomUUID();
      const results = await Promise.all([confirm({ expected, key }), confirm({ expected, key })]);
      assert.equal(results[0], results[1]);
      firstId = results[0];
      assert.equal(await confirm({ expected, key }), firstId);
      await assert.rejects(confirm({ expected, key, date: "2099-10-25" }), /anderen Verteilung/);
      const row = (await db.query<Record<string, string>>("select * from public.wealth_first_distributions where id=$1", [firstId])).rows[0];
      assert.equal(new Date(row.distribution_date).toISOString().slice(0,10), "2099-10-10");
      assert.equal(Number(row.resulting_buffer_cents), 0);
      assert.equal(Number(row.warning_threshold_cents_snapshot), 450000);
      const last = (await db.query<Record<string, string>>("select * from public.wealth_first_distribution_allocations where distribution_id=$1 and pot_id=$2", [firstId, ids[4]])).rows[0];
      assert.equal(Number(last.allocation_cents), 37812);
      assert.equal(Number(last.monthly_target_cents_snapshot) - Number(last.expected_month_total_cents), 4688);
      const service = (await db.query<Record<string, string>>("select * from public.wealth_first_distribution_allocations where distribution_id=$1 and pot_id=$2", [firstId, ids[0]])).rows[0];
      assert.equal(service.destination_type_snapshot, "service_account");
    });

    await t.test("second monthly run funds only CHF 46.88; Servicekonto receives zero, custom extra runs remain possible", async () => {
      const id = await confirm({ date: "2099-10-25", balance: 10_000, amounts: [0,0,0,0,4688] });
      const rows = await db.query<Record<string, string>>("select * from public.wealth_first_distribution_allocations where distribution_id=$1", [id]);
      assert.equal(Number(rows.rows.find((row) => row.pot_id === ids[0])?.allocation_cents), 0);
      assert.equal(Number(rows.rows.find((row) => row.pot_id === ids[4])?.already_allocated_cents_snapshot), 37812);
      const after = await state();
      assert.equal(after.buffer, 5312);
      await confirm({ date: "2099-10-27", balance: 5312, amounts: [0,0,0,0,0] });
      assert.equal((await state()).buffer, 5312);
    });

    await t.test("server rejects priority tampering, overspending, excess and unmarked reductions; manual postponement is allowed", async () => {
      const common = { date: "2099-11-10", month: "2099-11-01", balance: 5312 };
      await assert.rejects(confirm({ ...common, amounts: [0,5312,0,0,0] }), /veraltet/);
      await assert.rejects(confirm({ ...common, amounts: [4000,62000,0,0,0] }), /übersteigt/);
      await assert.rejects(confirm({ ...common, amounts: [5312,0,0,0,0], manual: [true] }), /übersteigt/);
      await confirm({ ...common, amounts: [1000,4312,0,0,0], manual: [true] });
      assert.equal((await state()).buffer, 0);
    });

    await t.test("invalid backdates, stale previews and changed keys reject without writes; concurrent tabs serialize", async () => {
      const expected = await state();
      const count = (await db.query("select count(*) from public.wealth_first_distributions")).rows;
      await assert.rejects(confirm({ date: "2099-10-26", amounts: [0,0,0,0,0], balance: 0 }), /liegt vor/);
      assert.deepEqual((await db.query("select count(*) from public.wealth_first_distributions")).rows, count);
      const common = { date: "2099-11-25", month: "2099-11-01", balance: 4000, amounts: [3000,1000,0,0,0], expected };
      const results = await Promise.allSettled([confirm(common), confirm(common)]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      await assert.rejects(confirm(common), /zwischenzeitlich geändert/);
    });

    await t.test("injected allocation failure rolls back distribution and buffer together", async () => {
      const before = await state();
      const rows = (await db.query("select count(*) from public.wealth_first_distributions")).rows;
      await db.exec("reset role; create function public.fail_allocation_v2() returns trigger language plpgsql as $$begin raise exception 'injected failure'; end$$; create trigger fail_allocation_v2 before insert on public.wealth_first_distribution_allocations for each row execute function public.fail_allocation_v2(); set role authenticated;");
      await assert.rejects(confirm({ date: "2099-12-10", month: "2099-12-01", balance: 40, amounts: [40,0,0,0,0] }), /injected failure/);
      assert.deepEqual(await state(), before);
      assert.deepEqual((await db.query("select count(*) from public.wealth_first_distributions")).rows, rows);
      await db.exec("reset role; drop trigger fail_allocation_v2 on public.wealth_first_distribution_allocations; drop function public.fail_allocation_v2(); set role authenticated;");
    });

    await t.test("editable renamed Servicekonto keeps first priority; saved buffer is not taxed again and old snapshots stay fixed", async () => {
      const snapshot = (await db.query("select to_jsonb(d) data from public.wealth_first_distributions d where id=$1", [firstId!])).rows;
      const allocationSnapshot = (await db.query("select to_jsonb(a) data from public.wealth_first_distribution_allocations a where distribution_id=$1 order by id", [firstId!])).rows;
      const changed = pots.map((pot, i) => i === 0 ? { ...pot, name: "Kartengeld", monthly_target_cents: 5000, sort_order: 999 } : pot);
      await db.query("select public.save_wealth_first_settings_v2($1,$2,2500,450000,null,$3::jsonb)", [book, (await state()).version, JSON.stringify(changed)]);
      const before = await state();
      await db.query("select public.reconcile_wealth_first_buffer_v1($1,$2,$3,$4,229500,'deposit','Bisherige Pufferreserve dokumentiert')", [book, randomUUID(), before.version, before.buffer]);
      const id = await confirm({ date: "2099-12-10", month: "2099-12-01", balance: 229603, amounts: [5000,62000,45000,75000,42500] });
      const row = (await db.query<Record<string, string>>("select * from public.wealth_first_distributions where id=$1", [id])).rows[0];
      assert.equal(Number(row.new_receipts_cents), 103);
      assert.equal(Number(row.tax_reserve_cents), 26);
      assert.equal(Number(row.resulting_buffer_cents), 77);
      assert.equal(Number(row.bank_balance_cents), Number(row.tax_reserve_cents) + Number(row.allocation_total_cents) + Number(row.resulting_buffer_cents));
      await assert.rejects(confirm({ date: "2099-12-11", month: "2099-12-01", balance: 76, amounts: [0,0,0,0,0] }), /abgestimmt/);
      assert.deepEqual((await db.query("select to_jsonb(d) data from public.wealth_first_distributions d where id=$1", [firstId!])).rows, snapshot);
      assert.deepEqual((await db.query("select to_jsonb(a) data from public.wealth_first_distribution_allocations a where distribution_id=$1 order by id", [firstId!])).rows, allocationSnapshot);
    });

    await t.test("fresh setup creates exactly one Servicekonto per eligible book; retries and cross-book destinations are safe", async () => {
      const secondBook = randomUUID();
      await db.exec("reset role");
      await db.query("insert into public.buchhaltungen values($1,$2,'Zweite CH','Schweiz','CHF','aktiv')", [secondBook, user]);
      await db.exec("set role authenticated");
      const newPots = pots.map((pot) => ({ ...pot, id: randomUUID() }));
      const setup = () => db.query("select public.save_wealth_first_settings_v2($1,null,2500,450000,0,$2::jsonb)", [secondBook, JSON.stringify(newPots)]);
      const attempts = await Promise.allSettled([setup(), setup()]);
      assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await db.query("select * from public.wealth_first_pots where buchhaltung_id=$1 and destination_type='service_account'", [secondBook])).rows.length, 1);
      await assert.rejects(db.query("select public.save_wealth_first_settings_v2($1,1,2500,450000,null,$2::jsonb)", [secondBook, JSON.stringify(pots)]), /gehört nicht/);
    });

    await t.test("historical data stays immutable, accounting untouched, ownership and country restrictions preserved", async () => {
      await db.exec("reset role");
      assert.deepEqual((await db.query("select * from public.accounting_sentinel")).rows, accounting);
      assert.deepEqual((await db.query("select to_jsonb(d)-'distribution_date' data from public.wealth_first_distributions d where distribution_date is null")).rows, legacyDistribution);
      await assert.rejects(db.query("update public.wealth_first_distributions set distribution_date='2099-01-01' where id=$1", [firstId!]), /unveränderlich/);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      await db.exec("set role authenticated");
      assert.equal((await db.query("select * from public.wealth_first_distributions")).rows.length, 0);
      await assert.rejects(db.query("select public.save_wealth_first_settings_v2($1,1,0,450000,null,$2::jsonb)", [book, JSON.stringify(pots)]), /Schweizer/);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec("set role authenticated");
      await assert.rejects(db.query("select public.save_wealth_first_settings_v2($1,null,0,450000,0,$2::jsonb)", [german, JSON.stringify(pots)]), /Schweizer/);
      await assert.rejects(db.query("insert into public.wealth_first_distributions(id) values($1)", [randomUUID()]), /permission denied/);
    });
  } finally { await db.close(); }
});
