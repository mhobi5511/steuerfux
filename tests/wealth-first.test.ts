import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  calculateWealthFirstDistribution,
  parseChfToCents
} from "../src/lib/wealth-first";

const mandatoryPots = [
  ["Kautionsfonds", 62_000],
  ["Guilt Free", 45_000],
  ["ETF-Investitionen", 75_000],
  ["Privater Notgroschen", 42_500]
] as const;

test("exact CHF 6'661.16 regression: old buffer is not taxed and all totals reconcile", () => {
  const result = calculateWealthFirstDistribution({
    bankBalanceCents: 666_116,
    previousBufferCents: 400_000,
    taxRateBasisPoints: 2_500,
    warningThresholdCents: 450_000,
    pots: mandatoryPots.map(([name, allocationCents], index) => ({
      potId: String(index), name, monthlyTargetCents: allocationCents,
      alreadyAllocatedCents: 0, allocationCents
    }))
  });
  assert.deepEqual({
    receipts: result.newReceiptsCents,
    tax: result.taxReserveCents,
    available: result.availableFundsCents,
    allocations: result.allocationTotalCents,
    bufferChange: result.bufferChangeCents,
    buffer: result.resultingBufferCents,
    warning: result.bufferWarning,
    reconciles: result.reconciles
  }, {
    receipts: 266_116,
    tax: 66_529,
    available: 199_587,
    allocations: 224_500,
    bufferChange: -24_913,
    buffer: 375_087,
    warning: true,
    reconciles: true
  });
});

test("insufficient new funds can use buffer; insufficient total funds remains blocked", () => {
  const covered = calculateWealthFirstDistribution({
    bankBalanceCents: 110_000, previousBufferCents: 100_000,
    taxRateBasisPoints: 2_500, warningThresholdCents: 50_000,
    pots: [{ potId: "p", name: "Topf", monthlyTargetCents: 20_000, alreadyAllocatedCents: 0, allocationCents: 20_000 }]
  });
  assert.equal(covered.availableFundsCents, 7_500);
  assert.equal(covered.resultingBufferCents, 87_500);
  assert.equal(covered.shortageCents, 0);
  const short = calculateWealthFirstDistribution({
    bankBalanceCents: 10_000, previousBufferCents: 5_000,
    taxRateBasisPoints: 2_500, warningThresholdCents: 4_500,
    pots: [{ potId: "p", name: "Topf", monthlyTargetCents: 20_000, alreadyAllocatedCents: 0, allocationCents: 20_000 }]
  });
  assert.equal(short.shortageCents, 11_250);
  assert.equal(short.reconciles, true);
});

test("negative difference requires reconciliation and cannot fabricate negative income or tax", () => {
  const result = calculateWealthFirstDistribution({
    bankBalanceCents: 399_999, previousBufferCents: 400_000,
    taxRateBasisPoints: 2_500, warningThresholdCents: 450_000, pots: []
  });
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.newReceiptsCents, 0);
  assert.equal(result.taxReserveCents, 0);
  assert.equal(result.reconciles, false);
});

test("monthly outstanding amount, explicit excess and cent rounding are deterministic", () => {
  const result = calculateWealthFirstDistribution({
    bankBalanceCents: 100_103, previousBufferCents: 100_000,
    taxRateBasisPoints: 2_500, warningThresholdCents: 100_000,
    pots: [{ potId: "p", name: "Topf", monthlyTargetCents: 62_000, alreadyAllocatedCents: 60_000, allocationCents: 2_001 }]
  });
  assert.equal(result.taxReserveCents, 26);
  assert.equal(result.pots[0].remainingTargetCents, 2_000);
  assert.equal(result.pots[0].exceedsRemainingTarget, true);
  assert.equal(result.pots[0].expectedTotalCents, 62_001);
  assert.equal(parseChfToCents("6'661.16"), 666_116);
  assert.equal(parseChfToCents("6.661,16"), 666_116);
});

test("isolated PostgreSQL: RLS, snapshots, idempotency, concurrency and atomic rollback", { timeout: 120_000 }, async (t) => {
  // In-memory WASM PostgreSQL only: no Supabase credentials or production connection.
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create table public.buchhaltungen(
        id uuid primary key, user_id uuid not null references auth.users(id), name text not null,
        country text not null, reporting_currency text not null, status text not null default 'aktiv',
        unique(id,user_id)
      );
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now(); return new; end$$;
    `);
    const migration = await readFile(
      new URL("../supabase/migrations/202610260001_wealth_first.sql", import.meta.url),
      "utf8"
    );
    await db.exec(migration);
    await db.exec(migration); // Additive and safe to rerun before any application data exists.
    const user = randomUUID(), other = randomUUID(), swiss = randomUUID(), foreign = randomUUID(), german = randomUUID();
    await db.query("insert into auth.users(id) values($1),($2)", [user, other]);
    await db.query(`insert into public.buchhaltungen(id,user_id,name,country,reporting_currency,status) values
      ($1,$4,'Swiss','Schweiz','CHF','aktiv'),($2,$5,'Other','Schweiz','CHF','aktiv'),($3,$4,'German','Deutschland','EUR','aktiv')`,
      [swiss, foreign, german, user, other]);
    await db.exec("grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    const potIds = mandatoryPots.map(() => randomUUID());
    const settingsPots = mandatoryPots.map(([name, amount], index) => ({
      id: potIds[index], name, monthly_target_cents: amount, active: true, sort_order: index
    }));
    await db.query(`select public.save_wealth_first_settings_v1($1,$2,$3,$4,$5,$6::jsonb)`,
      [swiss, null, 2500, 450000, 400000, JSON.stringify(settingsPots)]);

    const confirm = async (options: {
      request?: string; month?: string; balance?: number; buffer?: number; version?: number;
      amounts?: number[]; exceptional?: boolean[];
    } = {}) => {
      const allocations = potIds.map((potId, index) => ({
        pot_id: potId,
        allocation_cents: options.amounts?.[index] ?? mandatoryPots[index][1],
        exceptional: options.exceptional?.[index] ?? false
      }));
      const result = await db.query<{ id: string }>(
        `select public.confirm_wealth_first_distribution_v1($1,$2,$3,$4,$5,$6,$7::jsonb) as id`,
        [swiss, options.request ?? randomUUID(), options.month ?? "2026-10-01",
          options.balance ?? 666116, options.buffer ?? 400000, options.version ?? 1,
          JSON.stringify(allocations)]
      );
      return result.rows[0].id;
    };

    await t.test("mandatory example, immutable snapshots, no accounting writes", async () => {
      const request = randomUUID();
      const id = await confirm({ request });
      assert.equal(await confirm({ request }), id, "same key returns the existing distribution");
      const row = (await db.query<Record<string, string>>(`select new_receipts_cents,tax_reserve_cents,
        available_funds_cents,allocation_total_cents,buffer_change_cents,resulting_buffer_cents
        from public.wealth_first_distributions where id=$1`, [id])).rows[0];
      assert.deepEqual(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])), {
        new_receipts_cents: 266116, tax_reserve_cents: 66529, available_funds_cents: 199587,
        allocation_total_cents: 224500, buffer_change_cents: -24913, resulting_buffer_cents: 375087
      });
      assert.equal((await db.query("select * from public.wealth_first_distribution_allocations where distribution_id=$1", [id])).rows.length, 4);
      await db.exec("reset role");
      await assert.rejects(db.query("update public.wealth_first_distributions set tax_reserve_cents=0 where id=$1", [id]), /unveränderlich/);
      await db.exec("set role authenticated");
      assert.doesNotMatch(migration, /insert\s+into\s+public\.(incomes|expenses|bank_fees|payments)/i);
    });

    await t.test("same month does not fund full goals again and settings edits preserve history", async () => {
      await db.exec("reset role");
      const before = (await db.query("select to_jsonb(d) row from public.wealth_first_distributions d order by confirmed_at limit 1")).rows[0];
      await db.exec("set role authenticated");
      const settings = (await db.query<{ current_buffer_cents: string; version: string }>("select current_buffer_cents,version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      const second = await confirm({ balance: Number(settings.current_buffer_cents) + 10000, buffer: Number(settings.current_buffer_cents), version: Number(settings.version), amounts: [0,0,0,0] });
      const snapshots = await db.query<{ already_allocated_cents_snapshot: string; monthly_target_cents_snapshot: string }>("select already_allocated_cents_snapshot,monthly_target_cents_snapshot from public.wealth_first_distribution_allocations where distribution_id=$1", [second]);
      assert.equal(snapshots.rows.every((row) => row.already_allocated_cents_snapshot === row.monthly_target_cents_snapshot), true);
      const current = (await db.query<{ version: string }>("select version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      const changed = settingsPots.map((pot, index) => index === 0 ? { ...pot, name: "Kaution neu", monthly_target_cents: 70000 } : pot);
      await db.query("select public.save_wealth_first_settings_v1($1,$2,$3,$4,$5,$6::jsonb)", [swiss, Number(current.version), 3000, 500000, null, JSON.stringify(changed)]);
      await db.exec("reset role");
      const after = (await db.query("select to_jsonb(d) row from public.wealth_first_distributions d order by confirmed_at limit 1")).rows[0];
      assert.deepEqual(after, before);
      await db.exec("set role authenticated");
    });

    await t.test("negative balance, shortage and injected failure save nothing partially", async () => {
      const state = (await db.query<{ current_buffer_cents: string; version: string }>("select current_buffer_cents,version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      const before = Number((await db.query<{ count: string }>("select count(*) from public.wealth_first_distributions")).rows[0].count);
      await assert.rejects(confirm({ balance: Number(state.current_buffer_cents) - 1, buffer: Number(state.current_buffer_cents), version: Number(state.version), amounts: [0,0,0,0] }), /abgestimmt/);
      await assert.rejects(confirm({ balance: Number(state.current_buffer_cents), buffer: Number(state.current_buffer_cents), version: Number(state.version), amounts: [999999,0,0,0], exceptional: [true,false,false,false] }), /übersteigen/);
      await db.exec("reset role; create function public.fail_allocation() returns trigger language plpgsql as $$begin raise exception 'injected failure'; end$$; create trigger fail_allocation before insert on public.wealth_first_distribution_allocations for each row execute function public.fail_allocation(); set role authenticated;");
      await assert.rejects(confirm({ balance: Number(state.current_buffer_cents) + 10000, buffer: Number(state.current_buffer_cents), version: Number(state.version), amounts: [0,0,0,0] }), /injected failure/);
      assert.equal(Number((await db.query<{ count: string }>("select count(*) from public.wealth_first_distributions")).rows[0].count), before);
      const unchanged = (await db.query<{ current_buffer_cents: string; version: string }>("select current_buffer_cents,version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      assert.deepEqual(unchanged, state);
      await db.exec("reset role; drop trigger fail_allocation on public.wealth_first_distribution_allocations; drop function public.fail_allocation(); set role authenticated;");
    });

    await t.test("two concurrent tabs serialize; one stale request is rejected", async () => {
      const state = (await db.query<{ current_buffer_cents: string; version: string }>("select current_buffer_cents,version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      const options = { month: "2026-11-01", balance: Number(state.current_buffer_cents) + 10000, buffer: Number(state.current_buffer_cents), version: Number(state.version), amounts: [0,0,0,0] };
      const settled = await Promise.allSettled([confirm(options), confirm(options)]);
      assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
      assert.match(String((settled.find((result) => result.status === "rejected") as PromiseRejectedResult).reason), /zwischenzeitlich geändert/);
    });

    await t.test("RLS isolates users and German books; reconciliation is auditable and idempotent", async () => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      await db.exec("set role authenticated");
      assert.equal((await db.query("select * from public.wealth_first_distributions")).rows.length, 0);
      await assert.rejects(db.query("select public.save_wealth_first_settings_v1($1,null,2500,450000,0,$2::jsonb)", [german, JSON.stringify(settingsPots)]), /Schweizer/);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec("set role authenticated");
      const state = (await db.query<{ current_buffer_cents: string; version: string }>("select current_buffer_cents,version from public.wealth_first_settings where buchhaltung_id=$1", [swiss])).rows[0];
      const key = randomUUID();
      const reconcile = () => db.query<{ id: string }>("select public.reconcile_wealth_first_buffer_v1($1,$2,$3,$4,$5,'withdrawal','Private Entnahme dokumentiert') as id", [swiss, key, Number(state.version), Number(state.current_buffer_cents), Number(state.current_buffer_cents) - 1000]);
      const first = (await reconcile()).rows[0].id;
      assert.equal((await reconcile()).rows[0].id, first);
      assert.equal((await db.query("select * from public.wealth_first_reconciliations where id=$1", [first])).rows.length, 1);
    });
  } finally {
    await db.close();
  }
});
