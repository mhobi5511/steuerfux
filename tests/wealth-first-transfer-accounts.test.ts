import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  groupWealthFirstTransfers,
  wealthFirstTransferTotal
} from "../src/lib/wealth-first-transfers";

test("transfer overview groups the current allocations by four bank accounts", () => {
  const groups = groupWealthFirstTransfers([
    { accountKey: "glkb_tax", label: "Steuerrücklage", amountCents: 66_529 },
    { accountKey: "glkb_service", label: "Servicekonto", amountCents: 4_000 },
    { accountKey: "yuh", label: "Kautionsfonds", amountCents: 62_000 },
    { accountKey: "revolut", label: "Guilt Free", amountCents: 45_000 },
    { accountKey: "yuh", label: "ETF-Investitionen", amountCents: 75_000 },
    { accountKey: "yuh", label: "Privater Notgroschen", amountCents: 42_500 }
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.amountCents]), [
    ["GLKB Steuerkonto", 66_529], ["GLKB Servicekonto", 4_000], ["Revolut", 45_000], ["Yuh", 179_500]
  ]);
  assert.equal(groups.find((group) => group.accountKey === "yuh")?.items.length, 3);
  assert.equal(wealthFirstTransferTotal(groups), 295_029);
});

test("transfer overview includes partial funding only, omits zero lines and does not accept surplus", () => {
  const groups = groupWealthFirstTransfers([
    { accountKey: "glkb_tax", label: "Steuerrücklage", amountCents: 0 },
    { accountKey: "glkb_service", label: "Servicekonto", amountCents: 4_000 },
    { accountKey: "yuh", label: "Kautionsfonds", amountCents: 62_000 },
    { accountKey: "revolut", label: "Guilt Free", amountCents: 45_000 },
    { accountKey: "yuh", label: "ETF-Investitionen", amountCents: 75_000 },
    { accountKey: "yuh", label: "Privater Notgroschen", amountCents: 37_812 },
    // Investment surplus has no assigned bank account and is deliberately not passed here.
  ]);
  assert.deepEqual(groups.map((group) => [group.accountKey, group.amountCents]), [
    ["glkb_service", 4_000], ["revolut", 45_000], ["yuh", 174_812]
  ]);
  assert.equal(wealthFirstTransferTotal(groups), 223_812);
});

test("transfer-account migration is additive and configuration changes never rewrite a distribution", { timeout: 120_000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.buchhaltungen(id uuid primary key,user_id uuid not null references auth.users(id),name text,country text,reporting_currency text,status text,unique(id,user_id));
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
      grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
    const migration = async (file: string) => db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    await migration("202610260001_wealth_first.sql");
    await migration("202611100001_wealth_first_service_dates.sql");
    await migration("202611100002_wealth_first_buffer_target.sql");
    const user = randomUUID(), book = randomUUID();
    await db.query("insert into auth.users values($1)", [user]);
    await db.query("insert into public.buchhaltungen values($1,$2,'CH','Schweiz','CHF','aktiv')", [book,user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
    const pots = [
      ["Servicekonto",4000,"service_account","glkb_service"], ["Kautionsfonds",62000,"private_pot","yuh"],
      ["Guilt Free",45000,"private_pot","revolut"], ["ETF-Investitionen",75000,"private_pot","yuh"],
      ["Privater Notgroschen",42500,"private_pot","yuh"]
    ].map(([name, amount, destination, account], index) => ({ id: randomUUID(), name, monthly_target_cents: amount,
      destination_type: destination, transfer_account_key: account, active: true, sort_order: index }));
    // A pre-v3 distribution proves that the migration does not alter historical financial records.
    await db.query("select public.save_wealth_first_settings_v2($1,null,0,450000,0,$2::jsonb)", [book,JSON.stringify(pots)]);
    await db.query("select public.confirm_wealth_first_distribution_v2($1,$2,'2099-10-01','2099-10-10',228500,0,1,$3::jsonb)",
      [book,randomUUID(),JSON.stringify({ allocations: pots.map((pot) => ({ pot_id: pot.id, allocation_cents: pot.monthly_target_cents, manual_override: false })), surplus_transfer_confirmed: false, excess_buffer_release_confirmed: false })]);
    await db.exec("reset role");
    const historical = (await db.query("select to_jsonb(d) data from public.wealth_first_distributions d")).rows;
    await migration("202611100003_wealth_first_transfer_accounts.sql");
    await migration("202611100003_wealth_first_transfer_accounts.sql");
    assert.deepEqual((await db.query("select to_jsonb(d) data from public.wealth_first_distributions d")).rows, historical);
    await db.exec("set role authenticated");
    const state = async () => (await db.query<{ version: string }>("select version from public.wealth_first_settings where buchhaltung_id=$1", [book])).rows[0];
    await db.query("select public.save_wealth_first_settings_v3($1,$2,0,450000,'glkb_tax',null,$3::jsonb)", [book,Number((await state()).version),JSON.stringify(pots)]);
    const configured = (await db.query<{ tax_transfer_account_key: string }>("select tax_transfer_account_key from public.wealth_first_settings where buchhaltung_id=$1", [book])).rows[0];
    assert.equal(configured.tax_transfer_account_key,"glkb_tax");
    assert.equal((await db.query("select * from public.wealth_first_pots where transfer_account_key='yuh'")).rows.length,3);
    const changed = pots.map((pot) => pot.name === "Guilt Free" ? { ...pot, transfer_account_key: "yuh" } : pot);
    await db.query("select public.save_wealth_first_settings_v3($1,$2,0,450000,'glkb_tax',null,$3::jsonb)", [book,Number((await state()).version),JSON.stringify(changed)]);
    assert.deepEqual((await db.query("select to_jsonb(d) data from public.wealth_first_distributions d")).rows,historical);
    await assert.rejects(db.query("select public.save_wealth_first_settings_v3($1,$2,0,450000,'iban',null,$3::jsonb)", [book,Number((await state()).version),JSON.stringify(changed)]), /gültiges Überweisungskonto/);
  } finally { await db.close(); }
});
