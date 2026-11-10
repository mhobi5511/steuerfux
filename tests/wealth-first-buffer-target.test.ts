import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { calculateWealthFirstDistribution, WEALTH_FIRST_DEFAULT_TARGETS } from "../src/lib/wealth-first";

const pots = WEALTH_FIRST_DEFAULT_TARGETS.map((pot, index) => ({ ...pot, potId: String(index), sortOrder: index, alreadyAllocatedCents: 0 }));
const calc = (bankBalanceCents: number, previousBufferCents = 400_000, options: Partial<Parameters<typeof calculateWealthFirstDistribution>[0]> = {}) =>
  calculateWealthFirstDistribution({ bankBalanceCents, previousBufferCents, bufferTargetCents: 450_000,
    taxRateBasisPoints: 0, pots, ...options });

test("target: strong month reserves CHF 4'500 and earmarks CHF 1'215, weak month leaves CHF 2'715", () => {
  const strong = calc(800_000);
  assert.equal(strong.remainingAfterAllocationsCents, 571_500);
  assert.equal(strong.resultingBufferCents, 450_000);
  assert.equal(strong.bufferChangeCents, 50_000);
  assert.equal(strong.investmentSurplusCents, 121_500);
  assert.equal(strong.pendingSurplusCents, 121_500);
  assert.equal(strong.surplusTransferCents, 0);
  assert.equal(strong.expectedBankBalanceCents, 571_500);
  assert.equal(strong.reconciles, true);
  const weak = calc(500_000);
  assert.equal(weak.resultingBufferCents, 271_500);
  assert.equal(weak.bufferChangeCents, -128_500);
  assert.equal(weak.bufferShortfallCents, 178_500);
  assert.equal(weak.investmentSurplusCents, 0);
  assert.equal(weak.validationErrors.length, 0);
});

test("target: pending money is neither receipts nor funding; partial monthly targets survive", () => {
  const first = calc(223_812, 0);
  assert.equal(first.pots[4].allocationCents, 37_812);
  assert.equal(first.pots[4].remainingAfterCents, 4_688);
  assert.equal(first.resultingBufferCents, 0);
  assert.equal(first.investmentSurplusCents, 0);
  const next = calc(10_000, 0, { pots: pots.map((pot, i) => ({ ...pot, alreadyAllocatedCents: first.pots[i].allocationCents })) });
  assert.deepEqual(next.pots.map((pot) => pot.allocationCents), [0,0,0,0,4688]);
  const pending = calc(101_000, 1_000, { previousPendingSurplusCents: 100_000 });
  assert.equal(pending.newReceiptsCents, 0);
  assert.equal(pending.allocationTotalCents, 1_000);
  assert.equal(pending.pendingSurplusCents, 100_000);
  assert.equal(pending.resultingBufferCents, 0);
  assert.equal(pending.reconciles, true);
  assert.equal(calc(100_999, 1_000, { previousPendingSurplusCents: 100_000 }).reconciliationRequired, true);
});

test("target: previous excess requires release, actual transfer confirmation is independent", () => {
  const blocked = calc(600_000, 600_000, { pots: [] });
  assert.equal(blocked.previousBufferExcessCents, 150_000);
  assert.equal(blocked.excessBufferReleaseRequired, true);
  assert.ok(blocked.validationErrors.length);
  assert.equal(blocked.pendingSurplusCents, 150_000);
  const released = calc(600_000, 600_000, { pots: [], excessBufferReleaseConfirmed: true });
  assert.equal(released.validationErrors.length, 0);
  assert.equal(released.surplusTransferCents, 0);
  const transferred = calc(610_000, 600_000, { pots: [], excessBufferReleaseConfirmed: true, surplusTransferConfirmed: true,
    previousPendingSurplusCents: 10_000 });
  assert.equal(transferred.newReceiptsCents, 0);
  assert.equal(transferred.surplusTransferCents, 160_000);
  assert.equal(transferred.pendingSurplusCents, 0);
  assert.equal(transferred.expectedBankBalanceCents, 450_000);
});

test("target: integer reconciliation and upper/lower buffer bounds across tax, pending and target changes", () => {
  for (const previous of [0, 1, 400_000, 600_000]) for (const pending of [0, 100_003]) {
    for (const target of [0, 450_000, 700_000]) for (const receipts of [0, 1, 103, 533_333]) {
      for (const transferred of [false, true]) {
        const result = calc(previous + pending + receipts, previous, { previousPendingSurplusCents: pending,
          bufferTargetCents: target, taxRateBasisPoints: 2500, surplusTransferConfirmed: transferred, excessBufferReleaseConfirmed: true });
        assert.ok(result.resultingBufferCents >= 0 && result.resultingBufferCents <= target);
        assert.equal(result.validationErrors.length, 0);
        assert.equal(result.reconciles, true);
        assert.equal(result.newReceiptsCents, receipts);
        assert.equal(result.pendingSurplusCents + result.surplusTransferCents, pending + result.investmentSurplusCents);
      }
    }
  }
});

test("PostgreSQL target upgrade: history compatibility, pending surplus, transactions and ownership", { timeout: 120_000 }, async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.buchhaltungen(id uuid primary key,user_id uuid not null references auth.users(id),name text,
        country text,reporting_currency text,status text,unique(id,user_id));
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
      create table public.accounting_sentinel(id integer primary key,data jsonb);
      insert into public.accounting_sentinel values(1,'{"invoice":1234,"income":5678,"expense":90,"tax":12}');
      grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
    const load = (file: string) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    await db.exec(await load("202610260001_wealth_first.sql"));
    await db.exec(await load("202611100001_wealth_first_service_dates.sql"));
    const user = randomUUID(), other = randomUUID();
    await db.query("insert into auth.users values($1),($2)", [user, other]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    const createBook = async (buffer = 400_000, tax = 0, target = 450_000) => {
      const book = randomUUID();
      await db.exec("reset role");
      await db.query("insert into public.buchhaltungen values($1,$2,'CH','Schweiz','CHF','aktiv')", [book, user]);
      await db.exec("set role authenticated");
      const settingsPots = pots.map((pot, i) => ({ id: randomUUID(), name: pot.name,
        monthly_target_cents: pot.monthlyTargetCents, active: true, destination_type: pot.destinationType, sort_order: i }));
      await db.query("select public.save_wealth_first_settings_v2($1,null,$2,$3,$4,$5::jsonb)", [book,tax,target,buffer,JSON.stringify(settingsPots)]);
      return { id: book, pots: settingsPots };
    };
    const legacy = await createBook();
    const legacyKey = randomUUID();
    const legacyPayload = JSON.stringify(legacy.pots.map((pot) => ({ pot_id: pot.id,allocation_cents: pot.monthly_target_cents })));
    await db.query("select public.confirm_wealth_first_distribution_v2($1,$2,'2099-09-01','2099-09-10',800000,400000,1,$3::jsonb)",
      [legacy.id,legacyKey,legacyPayload]);
    await db.exec("reset role");
    const historical = (await db.query<{ data: { id: string } }>("select to_jsonb(d) data from public.wealth_first_distributions d")).rows;
    const historicalAllocations = (await db.query("select to_jsonb(a) data from public.wealth_first_distribution_allocations a order by id")).rows;
    const settingsBefore = (await db.query("select to_jsonb(s) data from public.wealth_first_settings s")).rows;
    const accountingBefore = (await db.query("select * from public.accounting_sentinel")).rows;
    const rpcOid = (await db.query("select oid from pg_proc where proname='confirm_wealth_first_distribution_v2'")).rows;
    const migration = await load("202611100002_wealth_first_buffer_target.sql");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query("select oid from pg_proc where proname='confirm_wealth_first_distribution_v2'")).rows, rpcOid);
    const newFields = ["buffer_target_cents_snapshot", "previous_pending_surplus_cents_snapshot", "investment_surplus_cents",
      "surplus_transfer_cents", "pending_surplus_cents", "surplus_transfer_confirmed_snapshot", "excess_buffer_release_confirmed_snapshot"];
    const legacyData = async () => (await db.query(`select to_jsonb(d) - $1::text[] data from public.wealth_first_distributions d where id=$2`, [newFields, (historical[0].data as { id: string }).id])).rows;
    assert.deepEqual(await legacyData(), historical);
    assert.deepEqual((await db.query("select to_jsonb(s)-'pending_surplus_cents' data from public.wealth_first_settings s")).rows, settingsBefore);
    await db.exec("set role authenticated");
    const replay = await db.query<{ id: string }>("select public.confirm_wealth_first_distribution_v2($1,$2,'2099-09-01','2099-09-10',800000,400000,1,$3::jsonb) id", [legacy.id,legacyKey,legacyPayload]);
    assert.equal(replay.rows[0].id,historical[0].data.id);
    type Book = Awaited<ReturnType<typeof createBook>>;
    const state = async (book: Book) => {
      const row = (await db.query<Record<string,string>>("select version,current_buffer_cents,pending_surplus_cents from public.wealth_first_settings where buchhaltung_id=$1", [book.id])).rows[0];
      return { version: Number(row.version), buffer: Number(row.current_buffer_cents), pending: Number(row.pending_surplus_cents ?? 0) };
    };
    const request = async (book: Book, balance: number, date = "2099-10-10", month = "2099-10-01", options: { transferred?: boolean; released?: boolean } = {}) => {
      const before = await state(book);
      const rate = (await db.query<Record<string,string>>("select tax_rate_basis_points,warning_threshold_cents from public.wealth_first_settings where buchhaltung_id=$1", [book.id])).rows[0];
      const already = (await db.query<{ pot_id: string; amount: string }>(`select a.pot_id,sum(a.allocation_cents) amount
        from public.wealth_first_distribution_allocations a join public.wealth_first_distributions d on d.id=a.distribution_id
        where d.buchhaltung_id=$1 and d.distribution_month=$2 group by a.pot_id`, [book.id,month])).rows;
      const calculation = calc(balance, before.buffer, { previousPendingSurplusCents: before.pending,
        bufferTargetCents: Number(rate.warning_threshold_cents), taxRateBasisPoints: Number(rate.tax_rate_basis_points),
        surplusTransferConfirmed: options.transferred, excessBufferReleaseConfirmed: options.released,
        pots: book.pots.map((pot) => ({ potId: pot.id, name: pot.name, monthlyTargetCents: pot.monthly_target_cents,
          destinationType: pot.destination_type, sortOrder: pot.sort_order,
          alreadyAllocatedCents: Number(already.find((row) => row.pot_id === pot.id)?.amount ?? 0) })) });
      return { book, balance, date, month, before, key: randomUUID(), payload: {
        surplus_transfer_confirmed: options.transferred ?? false, excess_buffer_release_confirmed: options.released ?? false,
        allocations: calculation.pots.map((pot) => ({ pot_id: pot.potId, allocation_cents: pot.allocationCents, manual_override: false })) } };
    };
    type Request = Awaited<ReturnType<typeof request>>;
    const confirm = async (input: Request) => (await db.query<{ id: string }>("select public.confirm_wealth_first_distribution_v2($1,$2,$3,$4,$5,$6,$7,$8::jsonb) id",
      [input.book.id,input.key,input.month,input.date,input.balance,input.before.buffer,input.before.version,JSON.stringify(input.payload)])).rows[0].id;
    const row = async (id: string) => (await db.query<Record<string,string>>("select * from public.wealth_first_distributions where id=$1", [id])).rows[0];
    const settle = async (book: Book, amount: number, date = "2099-10-11", kind = "transfer", reason = "Manueller Abgang ausdrücklich bestätigt", before?: Awaited<ReturnType<typeof state>>, key = randomUUID()) => {
      const expected = before ?? await state(book);
      return (await db.query<{ id: string }>("select public.settle_wealth_first_surplus_v1($1,$2,$3,$4,$5,$6,$7,$8) id",
        [book.id,key,expected.version,expected.pending,amount,date,kind,reason])).rows[0].id;
    };

    await t.test("strong and weak examples persist real buffer, exact tax and surplus snapshots", async () => {
      const strong = await createBook(400_000,2500);
      const first = await row(await confirm(await request(strong,933_333)));
      assert.equal(Number(first.available_funds_cents), 400_000);
      assert.equal(Number(first.resulting_buffer_cents), 450_000);
      assert.equal(Number(first.buffer_change_cents), 50_000);
      assert.equal(Number(first.investment_surplus_cents), 121_500);
      assert.equal(Number(first.pending_surplus_cents), 121_500);
      assert.equal(Number(first.surplus_transfer_cents), 0);
      assert.equal(Number(first.buffer_target_cents_snapshot), 450_000);
      assert.deepEqual(await state(strong), { version: 2, buffer: 450_000, pending: 121_500 });
      const weak = await createBook(400_000,2500);
      const weaker = await row(await confirm(await request(weak,533_333)));
      assert.equal(Number(weaker.resulting_buffer_cents), 271_500);
      assert.equal(Number(weaker.buffer_change_cents), -128_500);
      assert.equal(Number(weaker.investment_surplus_cents), 0);
    });

    await t.test("10th/25th partial goals carry over; Servicekonto is not repeated", async () => {
      const book = await createBook(0);
      const first = await confirm(await request(book,223_812));
      const allocation = (await db.query<Record<string,string>>("select * from public.wealth_first_distribution_allocations where distribution_id=$1 and pot_id=$2", [first,book.pots[4].id])).rows[0];
      assert.equal(Number(allocation.allocation_cents), 37_812);
      const next = await request(book,10_000,"2099-10-25");
      assert.deepEqual(next.payload.allocations.map((pot) => pot.allocation_cents), [0,0,0,0,4688]);
      const saved = await row(await confirm(next));
      assert.equal(Number(saved.resulting_buffer_cents), 5312);
      assert.equal(Number(saved.investment_surplus_cents), 0);
    });

    await t.test("pending surplus is excluded from new receipts and never reused for monthly goals", async () => {
      const book = await createBook(400_000,2500);
      await confirm(await request(book,933_333));
      const second = await row(await confirm(await request(book,581_500,"2099-10-25")));
      assert.equal(Number(second.new_receipts_cents), 10_000);
      assert.equal(Number(second.tax_reserve_cents), 2500);
      assert.equal(Number(second.investment_surplus_cents), 7500);
      assert.equal(Number(second.pending_surplus_cents), 129_000);
      const nextMonth = await row(await confirm(await request(book,579_000,"2099-11-10","2099-11-01")));
      assert.equal(Number(nextMonth.new_receipts_cents), 0);
      assert.equal(Number(nextMonth.tax_reserve_cents), 0);
      assert.equal(Number(nextMonth.pending_surplus_cents), 129_000);
      assert.equal(Number(nextMonth.resulting_buffer_cents), 221_500);
    });

    await t.test("only user-confirmed transfers remove surplus; snapshots stay immutable and retries compare flags", async () => {
      const book = await createBook();
      const input = await request(book,800_000,"2099-10-10","2099-10-01",{ transferred: true });
      const ids = await Promise.all([confirm(input),confirm(input)]);
      assert.equal(ids[0],ids[1]);
      assert.equal(await confirm(input), ids[0]);
      const saved = await row(ids[0]);
      assert.equal(Number(saved.surplus_transfer_cents),121_500);
      assert.equal(Number(saved.pending_surplus_cents),0);
      await assert.rejects(confirm({ ...input,payload: { ...input.payload,surplus_transfer_confirmed: false } }), /anderen Verteilung/);
      const next = await row(await confirm(await request(book,450_000,"2099-10-25")));
      assert.equal(Number(next.new_receipts_cents),0);
      assert.equal(Number(next.investment_surplus_cents),0);
    });

    await t.test("later partial transfer and non-transfer reconciliation are append-only, idempotent and not income", async () => {
      const book = await createBook();
      const first = await confirm(await request(book,800_000));
      const snapshot = await row(first), before = await state(book), key = randomUUID();
      const ids = await Promise.all([settle(book,50_000,undefined,undefined,undefined,before,key),settle(book,50_000,undefined,undefined,undefined,before,key)]);
      assert.equal(ids[0],ids[1]);
      assert.equal((await state(book)).pending,71_500);
      assert.deepEqual(await row(first),snapshot);
      await assert.rejects(settle(book,40_000,undefined,undefined,undefined,before,key), /anderen Überschuss/);
      const next = await row(await confirm(await request(book,521_500,"2099-10-25")));
      assert.equal(Number(next.new_receipts_cents),0);
      assert.equal(Number(next.pending_surplus_cents),71_500);
      await settle(book,71_500,"2099-10-26","reconciliation","Tatsächlicher anderer Bankabgang abgestimmt");
      assert.equal((await state(book)).pending,0);
      const events = await db.query<Record<string,string>>("select * from public.wealth_first_surplus_settlements where buchhaltung_id=$1 order by settlement_date", [book.id]);
      assert.equal(events.rows[0].settlement_type,"transfer");
      assert.equal(events.rows[1].settlement_type,"reconciliation");
      await assert.rejects(confirm(await request(book,450_000,"2099-10-25")), /liegt vor/);
      await db.exec("reset role");
      await assert.rejects(db.query("update public.wealth_first_surplus_settlements set amount_cents=1 where id=$1", [ids[0]]), /unveränderlich/);
      await db.exec("set role authenticated");
    });

    await t.test("ordinary buffer reconciliation cannot swallow pending surplus; actual settlement is required", async () => {
      const book = await createBook();
      await confirm(await request(book,800_000));
      const before = await state(book);
      await assert.rejects(db.query("select public.reconcile_wealth_first_buffer_v1($1,$2,$3,$4,571500,'other','Kontobewegung prüfen')",
        [book.id,randomUUID(),before.version,before.buffer]), /offenen Überschuss/);
      assert.deepEqual(await state(book),before);
      await assert.rejects(settle(book,121_501), /ungültig/);
      await settle(book,121_500);
      const cleared = await state(book);
      await db.query("select public.reconcile_wealth_first_buffer_v1($1,$2,$3,$4,449999,'withdrawal','Tatsächliche Entnahme dokumentiert')",
        [book.id,randomUUID(),cleared.version,cleared.buffer]);
      assert.equal((await state(book)).buffer,449_999);
    });

    await t.test("settings and previous above-target buffer are unchanged until an explicitly released distribution", async () => {
      const before = await state(legacy);
      assert.equal(before.buffer,571_500);
      await db.query("select public.save_wealth_first_settings_v2($1,$2,0,400000,null,$3::jsonb)", [legacy.id,before.version,JSON.stringify(legacy.pots)]);
      assert.equal((await state(legacy)).buffer,571_500);
      assert.deepEqual(await legacyData(),historical);
      await assert.rejects(confirm(await request(legacy,571_500,"2099-09-25","2099-09-01")), /Freigabe/);
      assert.equal((await state(legacy)).buffer,571_500);
      const released = await row(await confirm(await request(legacy,571_500,"2099-09-25","2099-09-01",{ released: true })));
      assert.equal(Number(released.resulting_buffer_cents),400_000);
      assert.equal(Number(released.investment_surplus_cents),171_500);
      assert.equal(Number(released.surplus_transfer_cents),0);
      assert.deepEqual(await legacyData(),historical);
    });

    await t.test("server priority, negative balance and stale preview checks remain strict", async () => {
      const book = await createBook(0);
      const input = await request(book,3000);
      const tampered = structuredClone(input);
      tampered.payload.allocations[0].allocation_cents=0;
      tampered.payload.allocations[1].allocation_cents=3000;
      await assert.rejects(confirm(tampered), /veraltet/);
      const overspent = structuredClone(input);
      overspent.payload.allocations[0].allocation_cents=4000;
      await assert.rejects(confirm(overspent), /übersteigt/);
      await assert.rejects(confirm({ ...input,balance: -1 }), /abgestimmt/);
      const concurrent = await Promise.allSettled([confirm(input),confirm({ ...input,key: randomUUID() })]);
      assert.equal(concurrent.filter((result) => result.status === "fulfilled").length,1);
      assert.equal(concurrent.filter((result) => result.status === "rejected").length,1);
    });

    await t.test("settlements and confirmations share the same version lock; stale and backdated requests cannot double-count", async () => {
      const book = await createBook();
      await confirm(await request(book,800_000));
      const before = await state(book), input = await request(book,571_500,"2099-10-25");
      const results = await Promise.allSettled([settle(book,1000,"2099-10-11","transfer",undefined,before),confirm(input)]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length,1);
      assert.equal(results.filter((result) => result.status === "rejected").length,1);
      await assert.rejects(settle(book,1000,"2099-10-01"), /liegt vor/);
    });

    await t.test("atomic allocation and settlement failure roll back rows, pending money and buffer together", async () => {
      const book = await createBook();
      const before = await state(book), input = await request(book,800_000);
      await db.exec("reset role; create function public.fail_target_allocation() returns trigger language plpgsql as $$begin raise exception 'allocation failure';end$$; create trigger fail_target_allocation before insert on public.wealth_first_distribution_allocations for each row execute function public.fail_target_allocation(); set role authenticated;");
      await assert.rejects(confirm(input), /allocation failure/);
      assert.deepEqual(await state(book),before);
      assert.equal((await db.query("select * from public.wealth_first_distributions where buchhaltung_id=$1", [book.id])).rows.length,0);
      await db.exec("reset role; drop trigger fail_target_allocation on public.wealth_first_distribution_allocations; drop function public.fail_target_allocation(); set role authenticated;");
      await confirm(input);
      const pending = await state(book);
      await db.exec("reset role; create function public.fail_target_state() returns trigger language plpgsql as $$begin raise exception 'state failure';end$$; create trigger fail_target_state before update on public.wealth_first_settings for each row execute function public.fail_target_state(); set role authenticated;");
      await assert.rejects(settle(book,1000), /state failure/);
      assert.deepEqual(await state(book),pending);
      assert.equal((await db.query("select * from public.wealth_first_surplus_settlements where buchhaltung_id=$1", [book.id])).rows.length,0);
      await db.exec("reset role; drop trigger fail_target_state on public.wealth_first_settings; drop function public.fail_target_state(); set role authenticated;");
    });

    await t.test("database constraints, ownership, historical snapshots and all accounting records remain protected", async () => {
      const book = await createBook();
      const input = await request(book,800_000);
      const id = await confirm(input);
      const own = await state(book);
      await db.exec("reset role");
      const data = (await db.query<{ data: Record<string,unknown> }>("select to_jsonb(d) data from public.wealth_first_distributions d where id=$1", [id])).rows[0].data;
      for (const changes of [{ resulting_buffer_cents: -1 },{ investment_surplus_cents: 1 },{ new_receipts_cents: 1 },{ pending_surplus_cents: 0 }]) {
        await assert.rejects(db.query("insert into public.wealth_first_distributions select (jsonb_populate_record(null::public.wealth_first_distributions,$1::jsonb)).*",
          [JSON.stringify({ ...data,...changes,id: randomUUID(),idempotency_key: randomUUID() })]), /check constraint/);
      }
      assert.deepEqual((await db.query("select * from public.accounting_sentinel")).rows,accountingBefore);
      assert.deepEqual(await legacyData(),historical);
      assert.deepEqual((await db.query("select to_jsonb(a) data from public.wealth_first_distribution_allocations a where distribution_id=$1 order by id", [(historical[0].data as { id: string }).id])).rows,historicalAllocations);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      await db.exec("set role authenticated");
      assert.equal((await db.query("select * from public.wealth_first_surplus_settlements")).rows.length,0);
      await assert.rejects(confirm(input), /eingerichtet/);
      await assert.rejects(settle(book,1,undefined,undefined,undefined,own), /eingerichtet/);
      await assert.rejects(db.query("insert into public.wealth_first_surplus_settlements(id) values($1)", [randomUUID()]), /permission denied/);
    });
  } finally { await db.close(); }
});
