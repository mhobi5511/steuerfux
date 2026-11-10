"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmWealthFirstDistribution,
  reconcileWealthFirstBuffer,
  saveWealthFirstSettings,
  settleWealthFirstSurplus
} from "@/app/actions/wealth-first";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  Buchhaltung,
  WealthFirstDistribution,
  WealthFirstPot,
  WealthFirstReconciliation,
  WealthFirstSurplusSettlement,
  WealthFirstSettings
} from "@/lib/db-types";
import {
  calculateWealthFirstDistribution,
  centsToInput,
  currentZurichMonth,
  currentZurichDate,
  distributionDateForMonth,
  formatChfCents,
  isDistributionDate,
  parseChfToCents,
  WEALTH_FIRST_DEFAULT_TARGETS
} from "@/lib/wealth-first";
import {
  DEFAULT_TAX_TRANSFER_ACCOUNT,
  groupWealthFirstTransfers,
  isWealthFirstTransferAccountKey,
  WEALTH_FIRST_TRANSFER_ACCOUNTS,
  wealthFirstTransferTotal,
  type WealthFirstTransferAccountKey
} from "@/lib/wealth-first-transfers";

type View = "overview" | "new" | "history" | "settings";
type EditablePot = { id: string; name: string; amount: string; active: boolean; destinationType: "service_account" | "private_pot"; transferAccountKey: WealthFirstTransferAccountKey };

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" }).format(
    new Date(`${month.slice(0, 7)}-01T12:00:00`)
  );
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function signedMoney(cents: number) {
  return `${cents >= 0 ? "+" : "−"}${formatChfCents(Math.abs(cents))}`;
}

function CopyAmountButton({ cents }: { cents: number }) {
  return <button type="button" className="rounded px-2 py-1 text-xs text-brand-700 hover:bg-brand-50" aria-label={`${formatChfCents(cents)} kopieren`} onClick={() => {
    void navigator.clipboard?.writeText((cents / 100).toFixed(2));
  }}>Kopieren</button>;
}

function Feedback({ message, error }: { message: string; error: string }) {
  if (!message && !error) return null;
  return (
    <div
      role="status"
      className={`rounded-2xl border px-4 py-3 text-sm ${
        error
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
    >
      {error || message}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

export function WealthFirstModule({
  buchhaltung,
  settings,
  pots,
  distributions,
  reconciliations,
  surplusSettlements
}: {
  buchhaltung: Buchhaltung;
  settings: WealthFirstSettings | null;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  reconciliations: WealthFirstReconciliation[];
  surplusSettlements: WealthFirstSurplusSettlement[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(settings ? "overview" : "settings");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const serviceReady = pots.some((pot) => pot.destination_type === "service_account" && pot.active);
  const transferAccountsReady = Boolean(settings?.tax_transfer_account_key) && pots.filter((pot) => pot.active).every((pot) => Boolean(pot.transfer_account_key));

  const navigate = (next: View) => {
    setMessage("");
    setError("");
    setView(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wealth First"
        description={`Liquiditätsverteilung für ${buchhaltung.name}. Berechnungen dokumentieren nur manuelle Überweisungen.`}
      />

      {settings ? (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Wealth-First-Bereiche">
          {([
            ["overview", "Übersicht"],
            ["new", "Neue Verteilung"],
            ["history", "Historie"],
            ["settings", "Einstellungen"]
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={view === value ? "primary" : "secondary"}
              onClick={() => navigate(value)}
              className="whitespace-nowrap"
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      <Feedback message={message} error={error} />

      {settings && (settings.pending_surplus_cents ?? 0) > 0 ? <SurplusSettlementPanel
        buchhaltungId={buchhaltung.id} settings={settings} pending={pending} run={startTransition}
        onResult={(result) => {
          setMessage(result.success ?? ""); setError(result.error ?? "");
          if (result.success) { setView("overview"); router.refresh(); }
        }} /> : null}

      {settings && (!serviceReady || !transferAccountsReady) ? <Card><p className="text-sm">Bitte das Servicekonto und die Überweisungszielkonten einmalig in den Einstellungen zuordnen und speichern. Ein vorhandenes Ziel kann weiterverwendet werden.</p></Card> : null}

      {!settings || view === "settings" || !serviceReady || !transferAccountsReady ? (
        <SettingsPanel
          buchhaltung={buchhaltung}
          settings={settings}
          pots={pots}
          pending={pending}
          onResult={(result) => {
            setMessage(result.success ?? "");
            setError(result.error ?? "");
            if (result.success) {
              setView("overview");
              router.refresh();
            }
          }}
          run={startTransition}
        />
      ) : null}

      {settings && serviceReady && transferAccountsReady && view === "overview" ? (
        <Overview
          settings={settings}
          pots={pots}
          distributions={distributions}
          onNew={() => navigate("new")}
          onHistory={() => navigate("history")}
        />
      ) : null}

      {settings && serviceReady && transferAccountsReady && view === "new" ? (
        <DistributionPanel
          buchhaltung={buchhaltung}
          settings={settings}
          pots={pots.filter((pot) => pot.active).sort((a, b) => Number(b.destination_type === "service_account") - Number(a.destination_type === "service_account") || a.sort_order - b.sort_order || a.id.localeCompare(b.id))}
          distributions={distributions}
          pending={pending}
          run={startTransition}
          onResult={(result) => {
            setMessage(result.success ?? "");
            setError(result.error ?? "");
            if (result.success) {
              setView("overview");
              router.refresh();
            }
          }}
        />
      ) : null}

      {settings && view === "history" ? (
        <History distributions={distributions} reconciliations={reconciliations} surplusSettlements={surplusSettlements} />
      ) : null}
    </div>
  );
}

function SettingsPanel({
  buchhaltung,
  settings,
  pots,
  pending,
  run,
  onResult
}: {
  buchhaltung: Buchhaltung;
  settings: WealthFirstSettings | null;
  pots: WealthFirstPot[];
  pending: boolean;
  run: (callback: () => Promise<void>) => void;
  onResult: (result: { success?: string; error?: string }) => void;
}) {
  const [taxRate, setTaxRate] = useState(
    settings ? (settings.tax_rate_basis_points / 100).toFixed(2) : "25.00"
  );
  const [buffer, setBuffer] = useState(settings ? centsToInput(settings.current_buffer_cents) : "");
  const [threshold, setThreshold] = useState(
    centsToInput(settings?.warning_threshold_cents ?? 450_000)
  );
  const [taxTransferAccountKey, setTaxTransferAccountKey] = useState<WealthFirstTransferAccountKey>(
    settings?.tax_transfer_account_key && isWealthFirstTransferAccountKey(settings.tax_transfer_account_key)
      ? settings.tax_transfer_account_key : DEFAULT_TAX_TRANSFER_ACCOUNT
  );
  const [editablePots, setEditablePots] = useState<EditablePot[]>(() => {
    if (!pots.length) return WEALTH_FIRST_DEFAULT_TARGETS.map((pot) => ({ id: "", name: pot.name, amount: centsToInput(pot.monthlyTargetCents), active: true, destinationType: pot.destinationType, transferAccountKey: pot.transferAccountKey }));
    const existing: EditablePot[] = pots.map((pot) => ({
          id: pot.id,
          name: pot.name,
          amount: centsToInput(pot.monthly_target_cents),
          active: pot.active,
          destinationType: pot.destination_type ?? "private_pot",
          transferAccountKey: pot.transfer_account_key && isWealthFirstTransferAccountKey(pot.transfer_account_key)
            ? pot.transfer_account_key : pot.destination_type === "service_account" ? "glkb_service"
              : pot.name.trim().toLocaleLowerCase("de-CH") === "guilt free" ? "revolut" : "yuh"
        }));
    // Name matching is only a suggestion in the settings editor, confirmed explicitly on save.
    if (!existing.some((pot) => pot.destinationType === "service_account")) {
      const candidate = existing.find((pot) => pot.name.trim().toLocaleLowerCase("de-CH") === "servicekonto");
      if (candidate) { candidate.destinationType = "service_account"; candidate.active = true; }
      else existing.unshift({ id: "", name: "Servicekonto", amount: "40.00", active: true, destinationType: "service_account", transferAccountKey: "glkb_service" });
    }
    return existing.sort((a, b) => Number(b.destinationType === "service_account") - Number(a.destinationType === "service_account"));
  });
  const isSetup = !settings;

  const submit = () => {
    const normalizedRate = Number(taxRate.replace(",", "."));
    const thresholdCents = parseChfToCents(threshold);
    const initialBufferCents = parseChfToCents(buffer);
    const normalizedPots = editablePots.map((pot, index) => ({
      id: pot.id || crypto.randomUUID(),
      name: pot.name.trim(),
      monthlyTargetCents: parseChfToCents(pot.amount),
      active: pot.active,
      destinationType: pot.destinationType,
      transferAccountKey: pot.transferAccountKey,
      sortOrder: index
    }));
    if (
      !Number.isFinite(normalizedRate) ||
      normalizedRate < 0 ||
      normalizedRate > 100 ||
      thresholdCents === null ||
      (isSetup && initialBufferCents === null) ||
      normalizedPots.some((pot) => !pot.name || pot.monthlyTargetCents === null)
    ) {
      onResult({ error: "Bitte Prozentsatz und alle CHF-Beträge mit höchstens zwei Nachkommastellen eingeben." });
      return;
    }
    run(async () => {
      const result = await saveWealthFirstSettings({
        buchhaltungId: buchhaltung.id,
        expectedVersion: settings?.version ?? null,
        taxRateBasisPoints: Math.round(normalizedRate * 100),
        bufferTargetCents: thresholdCents,
        taxTransferAccountKey,
        initialBufferCents: isSetup ? initialBufferCents : null,
        pots: normalizedPots.map((pot) => ({ ...pot, monthlyTargetCents: pot.monthlyTargetCents! }))
      });
      onResult(result);
    });
  };

  return (
    <Card className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">
          {isSetup ? "Ersteinrichtung" : "Konfiguration"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">
          {isSetup ? "Wealth First einrichten" : "Einstellungen bearbeiten"}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          {isSetup
            ? "Bestätige die Regeln und trage den bereits reservierten Business-Puffer ein. Dabei entstehen keine Buchungen oder historischen Verteilungen."
            : "Änderungen gelten erst für neue Verteilungen. Bestätigte Historieneinträge behalten ihre Snapshots."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Steuerrücklage (%)" hint="Liquiditätsreserve, keine Steuerberechnung oder Zahlung.">
          <Input value={taxRate} inputMode="decimal" onChange={(event) => setTaxRate(event.target.value)} />
        </Field>
        <Field label={isSetup ? "Aktuell reservierter Business-Puffer (CHF)" : "Business-Puffer (nur lesbar)"} hint={isSetup ? "Startsaldo für die erste Verteilung." : "Änderungen erfolgen nur über Verteilung oder protokollierte Abstimmung."}>
          <Input
            value={buffer}
            inputMode="decimal"
            disabled={!isSetup}
            onChange={(event) => setBuffer(event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Business-Puffer-Ziel (CHF)" hint="Nach den Monatszielen wird der Puffer bis zu diesem Betrag aufgefüllt. Darüber entsteht zusätzlicher Überschuss.">
          <Input value={threshold} inputMode="decimal" onChange={(event) => setThreshold(event.target.value)} />
        </Field>
        <Field label="Steuerrücklage überweisen an">
          <Select value={taxTransferAccountKey} onChange={(event) => setTaxTransferAccountKey(event.target.value as WealthFirstTransferAccountKey)}>
            {WEALTH_FIRST_TRANSFER_ACCOUNTS.map((account) => <option key={account.key} value={account.key}>{account.label}</option>)}
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">Servicekonto und private Spartöpfe</h3>
            <p className="text-sm text-slate-600">Servicekonto zuerst, danach private Ziele in der angezeigten Reihenfolge. Die interne Überweisung ist keine Betriebsausgabe.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditablePots((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "0.00", active: true, destinationType: "private_pot", transferAccountKey: "yuh" }])}
          >
            Topf hinzufügen
          </Button>
        </div>
        <div className="grid gap-3">
          {editablePots.map((pot, index) => (
            <div key={`${pot.id}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_14rem_14rem_auto] md:items-end dark:bg-slate-900">
              <Field label={pot.destinationType === "service_account" ? "Geschäftskonto · höchste Priorität" : `Privater Spartopf · Priorität ${index + 1}`}>
                <Input value={pot.name} onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              </Field>
              <Field label="Monatsziel (CHF)">
                <Input value={pot.amount} inputMode="decimal" onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} />
              </Field>
              <Field label="Überweisen an">
                <Select value={pot.transferAccountKey} onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, transferAccountKey: event.target.value as WealthFirstTransferAccountKey } : item))}>
                  {WEALTH_FIRST_TRANSFER_ACCOUNTS.map((account) => <option key={account.key} value={account.key}>{account.label}</option>)}
                </Select>
              </Field>
              <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={pot.active} disabled={pot.destinationType === "service_account"} onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />
                Aktiv
              </label>
            </div>
          ))}
        </div>
        {!pots.some((pot) => pot.destination_type === "service_account") && pots.length > 0 ? <Field label="Vorhandenes Ziel als Servicekonto verwenden" hint="Bei einem bestehenden Servicekonto dessen bisherigen Eintrag wählen. So bleiben frühere Monatszuweisungen zugeordnet."><Select value="" onChange={(event) => {
          if (!event.target.value) return;
          setEditablePots((current) => current.filter((pot) => pot.id || pot.destinationType !== "service_account").map<EditablePot>((pot) => ({ ...pot, destinationType: pot.id === event.target.value ? "service_account" : "private_pot", transferAccountKey: pot.id === event.target.value ? "glkb_service" : pot.transferAccountKey, active: pot.id === event.target.value ? true : pot.active })).sort((a, b) => Number(b.destinationType === "service_account") - Number(a.destinationType === "service_account")));
        }}><option value="">Zuordnung wählen …</option>{pots.map((pot) => <option key={pot.id} value={pot.id}>{pot.name}</option>)}</Select></Field> : null}
        <p className="text-sm font-medium">Aktives Monatsziel gesamt: {formatChfCents(editablePots.reduce((sum, pot) => sum + (pot.active ? parseChfToCents(pot.amount) ?? 0 : 0), 0))}</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Wird gespeichert …" : isSetup ? "Einstellungen speichern" : "Änderungen speichern"}
        </Button>
      </div>
    </Card>
  );
}

function priorAllocationByPot(distributions: WealthFirstDistribution[], month: string) {
  const totals = new Map<string, number>();
  for (const distribution of distributions) {
    if (distribution.distribution_month.slice(0, 7) !== month) continue;
    for (const allocation of distribution.allocations ?? []) {
      totals.set(allocation.pot_id, (totals.get(allocation.pot_id) ?? 0) + Number(allocation.allocation_cents));
    }
  }
  return totals;
}

function SurplusSettlementPanel({ buchhaltungId, settings, pending, run, onResult }: {
  buchhaltungId: string; settings: WealthFirstSettings; pending: boolean;
  run: (callback: () => Promise<void>) => void;
  onResult: (result: { success?: string; error?: string }) => void;
}) {
  const outstanding = settings.pending_surplus_cents ?? 0;
  const [amount, setAmount] = useState(() => centsToInput(outstanding));
  const [date, setDate] = useState(currentZurichDate);
  const [type, setType] = useState<"transfer" | "reconciliation">("transfer");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [requestId, setRequestId] = useState("");
  useEffect(() => { setAmount(centsToInput(outstanding)); }, [outstanding]);
  useEffect(() => { setRequestId(crypto.randomUUID()); setAttested(false); }, [amount, date, type, reason, settings.version]);
  const amountCents = parseChfToCents(amount);
  const valid = amountCents !== null && amountCents > 0 && amountCents <= outstanding && isDistributionDate(date)
    && attested && (type === "transfer" || reason.trim().length >= 5) && requestId;
  return <Card className="space-y-3 border-sky-200 bg-sky-50">
    <p className="font-semibold text-slate-950">Noch auf dem Einnahmenkonto: {formatChfCents(outstanding)} Investitionsüberschuss</p>
    <p className="text-sm text-slate-700">Dieser Betrag gehört nicht zum Business-Puffer und wird nicht erneut als Einnahme gezählt. Du kannst ihn vorerst liegen lassen. Hast du ihn bereits überwiesen, bestätige den Abgang vor der Eingabe des nächsten Bankstands.</p>
    <details><summary className="cursor-pointer text-sm font-medium text-brand-700">Bereits ausgeführten Abgang bestätigen oder abstimmen</summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Art des Abgangs"><Select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="transfer">Manuell für Investitionen überwiesen</option><option value="reconciliation">Anderen tatsächlichen Abgang abstimmen</option></Select></Field>
          <Field label="Tatsächlich abgegangener Betrag (CHF)" hint="Teilbeträge sind möglich. Der Rest bleibt offen."><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Datum des tatsächlichen Abgangs"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          {type === "reconciliation" ? <Field label="Begründung" hint="Mindestens 5 Zeichen; es wird keine Einnahme oder Ausgabe gebucht."><Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field> : null}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />Ich bestätige, dass dieser Betrag das Einnahmenkonto tatsächlich bereits verlassen hat. Die App führt keine Überweisung aus.</label>
        <Button type="button" variant="secondary" disabled={pending || !valid} onClick={() => {
          if (!valid || amountCents === null) return;
          run(async () => onResult(await settleWealthFirstSurplus({ buchhaltungId, idempotencyKey: requestId,
            expectedVersion: settings.version, expectedPendingCents: outstanding, amountCents,
            settlementDate: date, settlementType: type, reason: type === "transfer" ? "Manuelle Investitionsüberweisung ausdrücklich bestätigt" : reason })));
        }}>Abgang protokollieren</Button>
      </div>
    </details>
  </Card>;
}

function Overview({
  settings,
  pots,
  distributions,
  onNew,
  onHistory
}: {
  settings: WealthFirstSettings;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  onNew: () => void;
  onHistory: () => void;
}) {
  const month = currentZurichMonth();
  const allocated = priorAllocationByPot(distributions, month);
  const activePots = pots.filter((pot) => pot.active);
  const latest = distributions[0];
  const below = settings.current_buffer_cents < settings.warning_threshold_cents;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Gespeicherter Business-Puffer" value={formatChfCents(settings.current_buffer_cents)} note="Bleibt logisch im Einnahmenkonto." />
        <Metric label="Business-Puffer-Ziel" value={formatChfCents(settings.warning_threshold_cents)} note="Auffüllen nach den monatlichen Zuweisungen." />
        <Metric label="Offener Investitionsüberschuss" value={formatChfCents(settings.pending_surplus_cents ?? 0)} note="Separat vom Puffer; bis zur Bestätigung auf dem Einnahmenkonto." />
      </div>
      {below ? (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-semibold text-amber-800">Business-Puffer unter Ziel</p>
          <p className="mt-1 text-sm text-amber-700">Dein Business-Puffer liegt {formatChfCents(settings.warning_threshold_cents - settings.current_buffer_cents)} unter dem Ziel von {formatChfCents(settings.warning_threshold_cents)}. Weitere Verteilungen bleiben möglich.</p>
        </Card>
      ) : null}
      {settings.current_buffer_cents > settings.warning_threshold_cents ? <Card className="border-amber-300 bg-amber-50"><p className="text-sm text-amber-800">Der gespeicherte Puffer liegt {formatChfCents(settings.current_buffer_cents - settings.warning_threshold_cents)} über dem Ziel. Er bleibt unverändert. Erst eine neue Verteilung mit ausdrücklicher Freigabe kann den verbleibenden Überhang als Überschuss ausweisen.</p></Card> : null}
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">Monatsziele · {monthLabel(month)}</h2>
              <p className="text-sm text-slate-600">Bestätigte Zuweisungen werden bei weiteren Verteilungen abgezogen.</p>
            </div>
            <Button type="button" onClick={onNew}>Neue Verteilung</Button>
          </div>
          <div className="space-y-3">
            {activePots.map((pot) => {
              const done = allocated.get(pot.id) ?? 0;
              const remaining = Math.max(0, pot.monthly_target_cents - done);
              const percentage = pot.monthly_target_cents ? Math.min(100, Math.round(done / pot.monthly_target_cents * 100)) : 100;
              return (
                <div key={pot.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div><p className="font-medium text-slate-950">{pot.name}</p><p className="text-slate-500">{formatChfCents(done)} von {formatChfCents(pot.monthly_target_cents)}</p></div>
                    <span className="font-medium text-slate-700">Offen {formatChfCents(remaining)}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${percentage}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-semibold text-slate-950">Letzte Verteilung</h2>
          {latest ? (
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">{dateTimeLabel(latest.confirmed_at)} · {monthLabel(latest.distribution_month)}</p>
              <p>Verteilungsdatum: {latest.distribution_date ?? "Historisch nicht erfasst"}</p>
              <div className="flex justify-between gap-3"><span>Steuerrücklage</span><strong>{formatChfCents(latest.tax_reserve_cents)}</strong></div>
              <div className="flex justify-between gap-3"><span>Spartöpfe</span><strong>{formatChfCents(latest.allocation_total_cents)}</strong></div>
              <div className="flex justify-between gap-3"><span>Neuer Puffer</span><strong>{formatChfCents(latest.resulting_buffer_cents)}</strong></div>
              <Button type="button" variant="secondary" onClick={onHistory}>Historie öffnen</Button>
            </div>
          ) : <p className="text-sm text-slate-600">Noch keine Verteilung abgeschlossen.</p>}
        </Card>
      </div>
    </div>
  );
}

function DistributionPanel({
  buchhaltung,
  settings,
  pots,
  distributions,
  pending,
  run,
  onResult
}: {
  buchhaltung: Buchhaltung;
  settings: WealthFirstSettings;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  pending: boolean;
  run: (callback: () => Promise<void>) => void;
  onResult: (result: { success?: string; error?: string }) => void;
}) {
  const [month, setMonth] = useState(currentZurichMonth());
  const [distributionDate, setDistributionDate] = useState(() => distributionDateForMonth(currentZurichMonth(), "10"));
  const [bankBalance, setBankBalance] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [surplusTransferred, setSurplusTransferred] = useState(false);
  const [excessReleased, setExcessReleased] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [reconciliationType, setReconciliationType] = useState<"withdrawal" | "refund" | "deposit" | "transfer" | "other">("withdrawal");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [reconciliationId, setReconciliationId] = useState("");
  useEffect(() => { setRequestId(crypto.randomUUID()); setReconciliationId(crypto.randomUUID()); }, []);

  const already = useMemo(() => priorAllocationByPot(distributions, month), [distributions, month]);
  useEffect(() => { setAllocations({}); }, [month, settings.version]);
  useEffect(() => { setSurplusTransferred(false); setExcessReleased(false); }, [month, distributionDate, bankBalance, allocations, settings.version]);
  useEffect(() => { setRequestId(crypto.randomUUID()); }, [month, distributionDate, bankBalance, allocations, settings.version, surplusTransferred, excessReleased]);

  const balanceCents = parseChfToCents(bankBalance);
  const calculation = useMemo(() => {
    if (balanceCents === null) return null;
    const normalized = pots.map((pot) => ({
      potId: pot.id,
      name: pot.name,
      destinationType: pot.destination_type ?? "private_pot",
      sortOrder: pot.sort_order,
      monthlyTargetCents: pot.monthly_target_cents,
      alreadyAllocatedCents: already.get(pot.id) ?? 0,
      allocationCents: allocations[pot.id] === undefined ? undefined : parseChfToCents(allocations[pot.id]) ?? 0
    }));
    try {
      return calculateWealthFirstDistribution({
        bankBalanceCents: balanceCents,
        previousBufferCents: settings.current_buffer_cents,
        taxRateBasisPoints: settings.tax_rate_basis_points,
        bufferTargetCents: settings.warning_threshold_cents,
        previousPendingSurplusCents: settings.pending_surplus_cents ?? 0,
        surplusTransferConfirmed: surplusTransferred,
        excessBufferReleaseConfirmed: excessReleased,
        pots: normalized
      });
    } catch { return null; }
  }, [balanceCents, pots, already, allocations, settings, surplusTransferred, excessReleased]);

  const invalidAllocation = Object.values(allocations).some((value) => parseChfToCents(value) === null);
  const canConfirm = Boolean(calculation && !calculation.reconciliationRequired && calculation.validationErrors.length === 0 && calculation.reconciles && !invalidAllocation && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && isDistributionDate(distributionDate) && requestId);
  const quickDate = distributionDate === `${month}-10` ? "10" : distributionDate === `${month}-25` ? "25" : "custom";
  const transferGroups = useMemo(() => {
    if (!calculation) return [];
    const items = [];
    const taxKey = settings.tax_transfer_account_key;
    if (calculation.taxReserveCents > 0 && taxKey && isWealthFirstTransferAccountKey(taxKey)) {
      items.push({ accountKey: taxKey, label: "Steuerrücklage", amountCents: calculation.taxReserveCents });
    }
    for (const pot of calculation.pots) {
      const accountKey = pots.find((item) => item.id === pot.potId)?.transfer_account_key;
      if (accountKey && isWealthFirstTransferAccountKey(accountKey)) {
        items.push({ accountKey, label: pot.name, amountCents: pot.allocationCents });
      }
    }
    return groupWealthFirstTransfers(items);
  }, [calculation, pots, settings.tax_transfer_account_key]);
  const transferTotal = wealthFirstTransferTotal(transferGroups);

  const confirm = () => {
    if (!calculation || balanceCents === null || !canConfirm) return;
    run(async () => {
      const result = await confirmWealthFirstDistribution({
        buchhaltungId: buchhaltung.id,
        idempotencyKey: requestId,
        distributionMonth: month,
        distributionDate,
        bankBalanceCents: balanceCents,
        expectedBufferCents: settings.current_buffer_cents,
        expectedSettingsVersion: settings.version,
        surplusTransferConfirmed: surplusTransferred,
        excessBufferReleaseConfirmed: excessReleased,
        allocations: calculation.pots.map((pot) => ({ potId: pot.potId, allocationCents: pot.allocationCents, manualOverride: allocations[pot.potId] !== undefined }))
      });
      onResult(result);
    });
  };

  const reconcile = () => {
    if (balanceCents === null || !reconciliationId) return;
    run(async () => {
      const result = await reconcileWealthFirstBuffer({
        buchhaltungId: buchhaltung.id,
        idempotencyKey: reconciliationId,
        expectedVersion: settings.version,
        expectedBufferCents: settings.current_buffer_cents,
        actualBalanceCents: balanceCents,
        reconciliationType,
        reason: reconciliationReason
      });
      onResult(result);
      if (result.error) setReconciliationId(crypto.randomUUID());
    });
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 1 · Grundlagen</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Bankstand erfassen</h2></div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Verteilungsmonat" hint="Monat, für den die Ziele finanziert werden."><Input type="month" value={month} onChange={(event) => {
            const next = event.target.value;
            setMonth(next);
            if (quickDate !== "custom") setDistributionDate(distributionDateForMonth(next, quickDate));
          }} /></Field>
          <Field label="Termin wählen"><Select value={quickDate} onChange={(event) => {
            const selected = event.target.value;
            setDistributionDate(selected === "custom" ? "" : distributionDateForMonth(month, selected as "10" | "25"));
          }}><option value="10">10. des Monats</option><option value="25">25. des Monats</option><option value="custom">Anderes Datum</option></Select></Field>
          <Field label="Verteilungsdatum" hint="Tatsächlicher Ausführungstag, unabhängig vom Verteilungsmonat."><Input type="date" value={distributionDate} onChange={(event) => setDistributionDate(event.target.value)} /></Field>
          <Field label="Aktueller Kontostand Einnahmenkonto (CHF)" hint="Bankstand vor den unten aufgeführten manuellen Überweisungen, inklusive Puffer und noch offenem Überschuss."><Input value={bankBalance} inputMode="decimal" placeholder="0.00" onChange={(event) => setBankBalance(event.target.value)} /></Field>
        </div>
        {bankBalance && balanceCents === null ? <p className="text-sm text-rose-700">Bitte einen gültigen Kontostand mit höchstens zwei Nachkommastellen eingeben.</p> : null}
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">Der Bankstand besteht aus gespeichertem Business-Puffer, noch offenem Investitionsüberschuss und neuen Eingängen. Frühere Überschussüberweisungen zuerst oben bestätigen. Andere Kontobewegungen vor der Verteilung abstimmen.</p>
      </Card>

      {calculation?.reconciliationRequired ? (
        <Card className="space-y-4 border-rose-200 bg-rose-50">
          <div><h2 className="font-semibold text-rose-800">Abstimmung erforderlich</h2><p className="mt-1 text-sm leading-6 text-rose-700">Der Kontostand ist niedriger als Business-Puffer plus noch offener Überschuss. Bitte prüfe zwischenzeitliche Kontobewegungen. Es werden weder negative Einnahmen noch negative Steuerrücklagen berechnet.</p></div>
          {(settings.pending_surplus_cents ?? 0) > 0 ? <p className="text-sm text-rose-700">Bitte zuerst den tatsächlichen Überschuss-Abgang oben protokollieren. Eine Puffer-Abstimmung ist erst danach möglich.</p> : null}
          <ReconciliationFields type={reconciliationType} setType={setReconciliationType} reason={reconciliationReason} setReason={setReconciliationReason} />
          <div className="flex items-center justify-between gap-4"><p className="text-sm text-slate-700">Explizite Pufferkorrektur: {signedMoney((balanceCents ?? 0) - settings.current_buffer_cents)}</p><Button type="button" variant="danger" disabled={pending || (settings.pending_surplus_cents ?? 0) > 0 || reconciliationReason.trim().length < 5} onClick={reconcile}>Kontostand abstimmen</Button></div>
        </Card>
      ) : null}

      {calculation && !calculation.reconciliationRequired ? (
        <>
          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 2 · Berechnung</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Neue verfügbare Mittel</h2></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Bisheriger Business-Puffer" value={formatChfCents(settings.current_buffer_cents)} note="Wird nicht erneut besteuert." />
              <Metric label="Neue unverteilte Einnahmen" value={formatChfCents(calculation.newReceiptsCents)} />
              <Metric label={`Neue Steuerrücklage · ${(settings.tax_rate_basis_points / 100).toFixed(2)} %`} value={formatChfCents(calculation.taxReserveCents)} />
              <Metric label="Neue verfügbare Mittel" value={formatChfCents(calculation.availableFundsCents)} />
              {(settings.pending_surplus_cents ?? 0) > 0 ? <Metric label="Bisher offener Überschuss" value={formatChfCents(settings.pending_surplus_cents ?? 0)} note="Vom Bankstand abgezogen; keine neue Einnahme und keine erneute Zuweisung." /> : null}
            </div>
          </Card>

          {(["service_account", "private_pot"] as const).map((destinationType) => <Card key={destinationType} className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">{destinationType === "service_account" ? "Schritt 3 · Servicekonto" : "Schritt 4 · Spartöpfe"}</p><h2 className="mt-2 text-lg font-semibold text-slate-950">{destinationType === "service_account" ? "Geschäftliches Servicekonto finanzieren" : "Offene Monatsziele automatisch verteilen"}</h2><p className="mt-1 text-sm text-slate-600">Automatisch nach Priorität. Über «Anpassen» kannst du eine Zuweisung reduzieren oder auf CHF 0 verschieben.</p></div>
            <div className="space-y-3">
              {calculation.pots.filter((pot) => pot.destinationType === destinationType).map((pot) => (
                <div key={pot.potId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-3 lg:items-center dark:bg-slate-900">
                  <div><p className="font-medium text-slate-950">{pot.name}</p><p className="text-xs text-slate-500">Monatsziel {formatChfCents(pot.monthlyTargetCents)}</p></div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Bereits zugewiesen</span>{formatChfCents(pot.alreadyAllocatedCents)}</div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Noch offen</span>{formatChfCents(pot.remainingTargetCents)}</div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Aktuelle Zuweisung</span><strong>{formatChfCents(pot.allocationCents)}</strong></div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Danach noch offen</span>{formatChfCents(pot.remainingAfterCents)}</div>
                  <details><summary className="cursor-pointer text-sm text-brand-700">Anpassen</summary><div className="mt-2 space-y-2"><Field label="Reduzierte Zuweisung (CHF)"><Input value={allocations[pot.potId] ?? centsToInput(pot.allocationCents)} inputMode="decimal" onChange={(event) => setAllocations((current) => ({ ...current, [pot.potId]: event.target.value }))} /></Field><Button type="button" variant="secondary" onClick={() => setAllocations((current) => { const next = { ...current }; delete next[pot.potId]; return next; })}>Automatisch verteilen</Button></div></details>
                </div>
              ))}
            </div>
            {destinationType === "service_account" ? <p className="text-sm">Für private Spartöpfe verfügbar: <strong>{formatChfCents((balanceCents ?? 0) - (settings.pending_surplus_cents ?? 0) - calculation.taxReserveCents - calculation.pots.filter((pot) => pot.destinationType === "service_account").reduce((sum, pot) => sum + pot.allocationCents, 0))}</strong>. Interne Überweisung; keine Betriebsausgabe.</p> : null}
          </Card>)}
          {invalidAllocation || calculation.validationErrors.length ? <Card className="border-rose-200 bg-rose-50 text-sm text-rose-700"><p>Bestätigung gesperrt. {invalidAllocation ? "Bitte gültige CHF-Beträge mit höchstens zwei Nachkommastellen eingeben." : calculation.validationErrors.join(" ")}</p></Card> : null}

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 5 · Überweisungen</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Manuell auszuführende Verteilung · {distributionDate || "Datum wählen"}</h2><p className="text-sm text-slate-600">Monatsziele für {month ? monthLabel(month) : "Monat wählen"}. Es werden keine Banküberweisungen oder Buchungen ausgeführt.</p></div>
            <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-4 dark:bg-slate-900">
              <p className="py-3 font-semibold">Steuern</p>
              {calculation.taxReserveCents > 0 ? <div className="flex justify-between gap-4 py-3"><span>Steuerkonto</span><strong>{formatChfCents(calculation.taxReserveCents)}</strong></div> : null}
              <p className="py-3 font-semibold">Geschäftskonto</p>
              {calculation.pots.filter((pot) => pot.destinationType === "service_account" && pot.allocationCents > 0).map((pot) => <div key={pot.potId} className="flex justify-between gap-4 py-3"><span>{pot.name} · interne Überweisung</span><strong>{formatChfCents(pot.allocationCents)}</strong></div>)}
              <p className="py-3 font-semibold">Private Spartöpfe</p>
              {calculation.pots.filter((pot) => pot.destinationType !== "service_account" && pot.allocationCents > 0).map((pot) => <div key={pot.potId} className="flex justify-between gap-4 py-3"><span>{pot.name}</span><strong>{formatChfCents(pot.allocationCents)}</strong></div>)}
              <p className="py-3 font-semibold">Business-Puffer</p>
              <div className="flex justify-between gap-4 py-3"><span>Bisheriger Business-Puffer</span><strong>{formatChfCents(settings.current_buffer_cents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>Business-Puffer-Ziel</span><strong>{formatChfCents(settings.warning_threshold_cents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>{calculation.bufferChangeCents < 0 ? "Pufferentnahme" : "Pufferzuwachs"}</span><strong>{signedMoney(calculation.bufferChangeCents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>Neuer reservierter Business-Puffer</span><strong>{formatChfCents(calculation.resultingBufferCents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>Abstand zum Puffer-Ziel</span><strong>{formatChfCents(calculation.bufferShortfallCents)}</strong></div>
              <p className="py-3 font-semibold">Zusätzlicher Überschuss</p>
              <div className="flex justify-between gap-4 py-3"><span>Überschuss für zusätzliche Investitionen · neu</span><strong>{formatChfCents(calculation.investmentSurplusCents)}</strong></div>
              {(settings.pending_surplus_cents ?? 0) > 0 ? <div className="flex justify-between gap-4 py-3"><span>Bisher noch offener Überschuss</span><strong>{formatChfCents(settings.pending_surplus_cents ?? 0)}</strong></div> : null}
              <div className="flex justify-between gap-4 py-3"><span>Überschuss danach noch auf dem Einnahmenkonto</span><strong>{formatChfCents(calculation.pendingSurplusCents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>Erwarteter Rest im Einnahmenkonto · Puffer plus offener Überschuss</span><strong>{formatChfCents(calculation.expectedBankBalanceCents)}</strong></div>
              <div className="flex justify-between gap-4 py-3"><span>Monatsziele danach noch offen</span><strong>{formatChfCents(calculation.pots.reduce((sum, pot) => sum + pot.remainingAfterCents, 0))}</strong></div>
            </div>
            {calculation.totalSurplusCents > 0 ? <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
              <p>{formatChfCents(calculation.totalSurplusCents)} können für zusätzliche Investitionen manuell überwiesen werden. Der monatliche ETF-Topf bleibt davon getrennt. Ohne deine Bestätigung bleibt der Überschuss ausdrücklich offen auf dem Einnahmenkonto.</p>
              <label className="flex items-start gap-2"><input type="checkbox" checked={surplusTransferred} onChange={(event) => setSurplusTransferred(event.target.checked)} />Ich habe zusätzlich {formatChfCents(calculation.totalSurplusCents)} nach Erfassung des obigen Bankstands manuell vom Einnahmenkonto für Investitionen überwiesen.</label>
            </div> : null}
            {calculation.excessBufferReleaseRequired ? <label className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><input type="checkbox" checked={excessReleased} onChange={(event) => setExcessReleased(event.target.checked)} />Der bisherige Puffer liegt {formatChfCents(calculation.previousBufferExcessCents)} über dem Ziel. Ich gebe den nach den Monatszielen verbleibenden Überhang ausdrücklich als Investitionsüberschuss frei. Erst die Bestätigung dieser Verteilung ändert den gespeicherten Puffer.</label> : null}
            <p className="text-sm text-slate-600">Offene Monatsziele werden bei der nächsten Verteilung desselben Monats berücksichtigt. Sie sind keine Schulden oder Betriebsausgaben.</p>
            {calculation.bufferBelowTarget ? <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Dein Business-Puffer liegt {formatChfCents(calculation.bufferShortfallCents)} unter dem Ziel von {formatChfCents(settings.warning_threshold_cents)}. Die Bestätigung bleibt möglich.</div> : null}
            <div className={`rounded-2xl border p-4 text-sm ${calculation.reconciles ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{calculation.reconciles ? `Auf den Rappen abgestimmt: Steuern ${formatChfCents(calculation.taxReserveCents)} + Servicekonto und Spartöpfe ${formatChfCents(calculation.allocationTotalCents)} + bestätigte Überschussüberweisung ${formatChfCents(calculation.surplusTransferCents)} + Puffer ${formatChfCents(calculation.resultingBufferCents)} + offener Überschuss ${formatChfCents(calculation.pendingSurplusCents)} = ${formatChfCents(balanceCents ?? 0)}` : "Die Beträge stimmen nicht exakt. Eine Bestätigung ist gesperrt."}</div>
          </Card>

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 6 · Bestätigen</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Überweisungen prüfen und Verteilung abschliessen</h2><p className="mt-2 text-sm text-slate-600">Diese Übersicht fasst nur die jetzt tatsächlich notwendigen Überweisungen zusammen. Der zusätzliche Investitionsüberschuss ist bewusst nicht enthalten.</p></div>
            {transferGroups.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-900"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-3">Zielkonto</th><th className="px-4 py-3 text-right">Zu überweisender Betrag</th></tr></thead><tbody>{transferGroups.map((group) => <tr key={group.accountKey} className="border-t border-slate-200"><td className="px-4 py-3"><p className="font-medium text-slate-950">{group.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{group.items.map((item) => `${item.label} ${formatChfCents(item.amountCents)}`).join(" · ")}</p></td><td className="px-4 py-3 text-right"><strong>{formatChfCents(group.amountCents)}</strong><div><CopyAmountButton cents={group.amountCents} /></div></td></tr>)}<tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:bg-slate-800"><td className="px-4 py-3">Gesamtsumme</td><td className="px-4 py-3 text-right">{formatChfCents(transferTotal)}</td></tr></tbody></table></div> : <p className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">Für diese Verteilung sind keine Überweisungen erforderlich.</p>}
            {calculation.totalSurplusCents > 0 ? <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">Zusätzlicher Investitionsüberschuss: {formatChfCents(calculation.totalSurplusCents)} · noch keinem Zielkonto zugeordnet und nicht in der Gesamtsumme enthalten.</p> : null}
            <div><h2 className="text-lg font-semibold text-slate-950">Verteilung vom {distributionDate || "…"} verbindlich speichern</h2><p className="mt-2 text-sm text-slate-600">Mit der Bestätigung bestätigst du die manuelle Ausführung der aufgeführten Steuer-, Servicekonto- und Spartopfüberweisungen. Der Überschuss gilt nur mit der zusätzlichen Bestätigung oben als überwiesen. Puffer, offener Überschuss und unveränderliche Snapshots werden atomar gespeichert. Die App führt keine Banküberweisungen aus.</p></div>
            {!isDistributionDate(distributionDate) ? <p className="text-sm text-rose-700">Bitte ein gültiges Verteilungsdatum wählen.</p> : null}
            <div className="flex justify-end"><Button type="button" disabled={!canConfirm || pending} onClick={confirm}>{pending ? "Wird bestätigt …" : "Verteilung abschliessen"}</Button></div>
          </Card>

          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:bg-slate-900">
            <summary className="cursor-pointer font-medium text-slate-950">Andere Kontobewegung vor der Verteilung abstimmen</summary>
            <div className="mt-4 space-y-4"><p className="text-sm leading-6 text-slate-600">Nutze dies nur, wenn der Unterschied ausdrücklich keine neu zu versteuernde Einnahme darstellt, zum Beispiel wegen einer Entnahme, Rückerstattung, früheren Überweisung oder nicht zuordenbaren Einzahlung. Offenen Investitionsüberschuss vorher separat als tatsächlich abgegangen bestätigen oder abstimmen. Die anschließende Puffer-Abstimmung wird protokolliert und setzt den gespeicherten Puffer auf den eingegebenen Bankstand.</p><ReconciliationFields type={reconciliationType} setType={setReconciliationType} reason={reconciliationReason} setReason={setReconciliationReason} /><Button type="button" variant="secondary" disabled={pending || (settings.pending_surplus_cents ?? 0) > 0 || reconciliationReason.trim().length < 5} onClick={reconcile}>Abstimmung separat speichern</Button></div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function ReconciliationFields({ type, setType, reason, setReason }: { type: "withdrawal" | "refund" | "deposit" | "transfer" | "other"; setType: (value: "withdrawal" | "refund" | "deposit" | "transfer" | "other") => void; reason: string; setReason: (value: string) => void }) {
  return <div className="grid gap-4 md:grid-cols-2"><Field label="Art der Abweichung"><Select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="withdrawal">Entnahme</option><option value="refund">Rückerstattung</option><option value="deposit">Nicht zuordenbare Einzahlung</option><option value="transfer">Frühere Überweisung</option><option value="other">Andere Kontobewegung</option></Select></Field><Field label="Begründung" hint="Mindestens 5 Zeichen; bleibt in der Abstimmungshistorie erhalten."><Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field></div>;
}

function History({ distributions, reconciliations, surplusSettlements }: { distributions: WealthFirstDistribution[]; reconciliations: WealthFirstReconciliation[]; surplusSettlements: WealthFirstSurplusSettlement[] }) {
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div><h2 className="text-lg font-semibold text-slate-950">Abgeschlossene Verteilungen</h2><p className="text-sm text-slate-600">Unveränderliche Berechnungs-, Einstellungs- und Topf-Snapshots.</p></div>
        {distributions.length ? distributions.map((distribution) => (
          <details key={distribution.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
            <summary className="cursor-pointer list-none"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><div><span className="block text-xs text-slate-500">Verteilungsdatum</span>{distribution.distribution_date ?? "Historisch nicht erfasst"}<span className="mt-1 block text-xs text-slate-500">Bestätigt: {dateTimeLabel(distribution.confirmed_at)}</span></div><div><span className="block text-xs text-slate-500">Verteilungsmonat</span>{monthLabel(distribution.distribution_month)}</div><div><span className="block text-xs text-slate-500">Kontostand</span>{formatChfCents(distribution.bank_balance_cents)}</div><div><span className="block text-xs text-slate-500">Steuerrücklage</span>{formatChfCents(distribution.tax_reserve_cents)}</div><div><span className="block text-xs text-slate-500">Zuweisungen</span>{formatChfCents(distribution.allocation_total_cents)}</div><div><span className="block text-xs text-slate-500">Neuer Puffer</span>{formatChfCents(distribution.resulting_buffer_cents)}</div></div></summary>
            <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Alter Puffer" value={formatChfCents(distribution.previous_buffer_cents)} /><Metric label="Neue Einnahmen" value={formatChfCents(distribution.new_receipts_cents)} /><Metric label={`Steuersatz ${(distribution.tax_rate_basis_points_snapshot / 100).toFixed(2)} %`} value={formatChfCents(distribution.tax_reserve_cents)} /><Metric label="Pufferveränderung" value={signedMoney(distribution.buffer_change_cents)} /></div>
              {distribution.buffer_target_cents_snapshot !== null && distribution.buffer_target_cents_snapshot !== undefined ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Business-Puffer-Ziel damals" value={formatChfCents(distribution.buffer_target_cents_snapshot)} />
                <Metric label="Neuer Investitionsüberschuss" value={formatChfCents(distribution.investment_surplus_cents ?? 0)} />
                <Metric label="Überschussüberweisung bei Bestätigung" value={formatChfCents(distribution.surplus_transfer_cents ?? 0)} note={distribution.surplus_transfer_confirmed_snapshot ? "Vom Benutzer als ausgeführt bestätigt." : "Keine Ausführung bestätigt."} />
                <Metric label="Bei Bestätigung noch offen" value={formatChfCents(distribution.pending_surplus_cents ?? 0)} note="Spätere Abgänge sind separat unten protokolliert." />
              </div> : null}
              <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="px-3 py-2">Ziel-Snapshot</th><th className="px-3 py-2">Monatsziel</th><th className="px-3 py-2">Vorher</th><th className="px-3 py-2">Zuweisung</th><th className="px-3 py-2">Danach</th></tr></thead><tbody>{(distribution.allocations ?? []).map((allocation) => <tr key={allocation.id} className="border-t border-slate-200"><td className="px-3 py-2">{allocation.pot_name_snapshot}<span className="block text-xs text-slate-500">{allocation.destination_type_snapshot === "service_account" ? "Geschäftskonto" : allocation.destination_type_snapshot === "private_pot" ? "Privater Spartopf" : "Historische Zuordnung nicht erfasst"}</span>{allocation.exceptional ? " · Ausnahme" : ""}</td><td className="px-3 py-2">{formatChfCents(allocation.monthly_target_cents_snapshot)}</td><td className="px-3 py-2">{formatChfCents(allocation.already_allocated_cents_snapshot)}</td><td className="px-3 py-2">{formatChfCents(allocation.allocation_cents)}</td><td className="px-3 py-2">{formatChfCents(allocation.expected_month_total_cents)}</td></tr>)}</tbody></table></div>
              <p className="text-xs text-slate-500">Einstellungsstand {distribution.settings_version_snapshot}{distribution.buffer_target_cents_snapshot == null ? ` · Historische Warnschwelle ${formatChfCents(distribution.warning_threshold_cents_snapshot)} · keine nachträgliche Zielberechnung` : " · Puffer-Ziel und Überschuss unveränderlich gespeichert"}</p>
            </div>
          </details>
        )) : <p className="text-sm text-slate-600">Noch keine bestätigte Verteilung.</p>}
      </Card>
      <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">Spätere Überschuss-Abgänge</h2><p className="text-sm text-slate-600">Manuell bestätigte Überweisungen und separat begründete Abstimmungen. Die ursprünglichen Verteilungen bleiben unverändert.</p></div>
        {surplusSettlements.length ? surplusSettlements.map((event) => <div key={event.id} className="space-y-2 rounded-2xl border border-slate-200 p-4 text-sm">
          <p className="font-medium">{event.settlement_date} · {event.settlement_type === "transfer" ? "Manuelle Überweisung bestätigt" : "Anderer Abgang abgestimmt"} · {formatChfCents(event.amount_cents)}</p>
          <p>Offener Überschuss: {formatChfCents(event.previous_pending_cents)} → {formatChfCents(event.resulting_pending_cents)}. Puffer unverändert: {formatChfCents(event.buffer_cents_snapshot)}.</p>
          <p className="text-slate-600">{event.reason}</p>
        </div>) : <p className="text-sm text-slate-600">Noch keine späteren Überschuss-Abgänge protokolliert.</p>}
      </Card>
      <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">Puffer-Abstimmungen</h2><p className="text-sm text-slate-600">Separat von Buchhaltung und Verteilungen protokolliert.</p></div>{reconciliations.length ? reconciliations.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:bg-slate-900"><div className="grid gap-3 md:grid-cols-4"><div><span className="block text-xs text-slate-500">Zeitpunkt</span>{dateTimeLabel(item.confirmed_at)}</div><div><span className="block text-xs text-slate-500">Vorher</span>{formatChfCents(item.previous_buffer_cents)}</div><div><span className="block text-xs text-slate-500">Korrektur</span>{signedMoney(item.adjustment_cents)}</div><div><span className="block text-xs text-slate-500">Danach</span>{formatChfCents(item.resulting_buffer_cents)}</div></div><p className="mt-3 text-slate-700">{item.reason}</p></div>) : <p className="text-sm text-slate-600">Keine Abstimmungen protokolliert.</p>}</Card>
    </div>
  );
}
