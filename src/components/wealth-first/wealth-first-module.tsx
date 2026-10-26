"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmWealthFirstDistribution,
  reconcileWealthFirstBuffer,
  saveWealthFirstSettings
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
  WealthFirstSettings
} from "@/lib/db-types";
import {
  calculateWealthFirstDistribution,
  centsToInput,
  currentZurichMonth,
  formatChfCents,
  parseChfToCents
} from "@/lib/wealth-first";

type View = "overview" | "new" | "history" | "settings";
type EditablePot = { id: string; name: string; amount: string; active: boolean };

const initialPotDefaults = [
  ["Kautionsfonds", "620.00"],
  ["Guilt Free", "450.00"],
  ["ETF-Investitionen", "750.00"],
  ["Privater Notgroschen", "425.00"]
] as const;

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
  reconciliations
}: {
  buchhaltung: Buchhaltung;
  settings: WealthFirstSettings | null;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  reconciliations: WealthFirstReconciliation[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(settings ? "overview" : "settings");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

      {!settings || view === "settings" ? (
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

      {settings && view === "overview" ? (
        <Overview
          settings={settings}
          pots={pots}
          distributions={distributions}
          onNew={() => navigate("new")}
          onHistory={() => navigate("history")}
        />
      ) : null}

      {settings && view === "new" ? (
        <DistributionPanel
          buchhaltung={buchhaltung}
          settings={settings}
          pots={pots.filter((pot) => pot.active)}
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
        <History distributions={distributions} reconciliations={reconciliations} />
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
  const [editablePots, setEditablePots] = useState<EditablePot[]>(() =>
    pots.length
      ? pots.map((pot) => ({
          id: pot.id,
          name: pot.name,
          amount: centsToInput(pot.monthly_target_cents),
          active: pot.active
        }))
      : initialPotDefaults.map(([name, amount]) => ({ id: "", name, amount, active: true }))
  );
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
        warningThresholdCents: thresholdCents,
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
        <Field label="Warnschwelle Business-Puffer (CHF)">
          <Input value={threshold} inputMode="decimal" onChange={(event) => setThreshold(event.target.value)} />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">Spartöpfe</h3>
            <p className="text-sm text-slate-600">Namen und Monatsziele bleiben in jeder Verteilung als Snapshot erhalten.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditablePots((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "0.00", active: true }])}
          >
            Topf hinzufügen
          </Button>
        </div>
        <div className="grid gap-3">
          {editablePots.map((pot, index) => (
            <div key={`${pot.id}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_14rem_auto] md:items-end dark:bg-slate-900">
              <Field label="Name">
                <Input value={pot.name} onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
              </Field>
              <Field label="Monatsziel (CHF)">
                <Input value={pot.amount} inputMode="decimal" onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} />
              </Field>
              <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={pot.active} onChange={(event) => setEditablePots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />
                Aktiv
              </label>
            </div>
          ))}
        </div>
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
        <Metric label="Warnschwelle" value={formatChfCents(settings.warning_threshold_cents)} note={below ? "Der aktuelle Puffer liegt darunter." : "Der aktuelle Puffer liegt darüber."} />
        <Metric label="Status" value={below ? "Unter Warnschwelle" : "Im grünen Bereich"} note="Die Warnung blockiert keine Verteilung." />
      </div>
      {below ? (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-semibold text-amber-800">Business-Puffer unter Warnschwelle</p>
          <p className="mt-1 text-sm text-amber-700">Prüfe geplante Zuweisungen besonders sorgfältig.</p>
        </Card>
      ) : null}
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
  const [bankBalance, setBankBalance] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [exceptional, setExceptional] = useState<Record<string, boolean>>({});
  const [requestId, setRequestId] = useState("");
  const [reconciliationType, setReconciliationType] = useState<"withdrawal" | "refund" | "deposit" | "transfer" | "other">("withdrawal");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [reconciliationId, setReconciliationId] = useState("");
  useEffect(() => { setRequestId(crypto.randomUUID()); setReconciliationId(crypto.randomUUID()); }, []);

  const already = useMemo(() => priorAllocationByPot(distributions, month), [distributions, month]);
  useEffect(() => {
    setAllocations(Object.fromEntries(pots.map((pot) => [pot.id, centsToInput(Math.max(0, pot.monthly_target_cents - (already.get(pot.id) ?? 0)))])));
    setExceptional({});
  }, [month, pots, already]);

  const balanceCents = parseChfToCents(bankBalance);
  const calculation = useMemo(() => {
    if (balanceCents === null) return null;
    const normalized = pots.map((pot) => ({
      potId: pot.id,
      name: pot.name,
      monthlyTargetCents: pot.monthly_target_cents,
      alreadyAllocatedCents: already.get(pot.id) ?? 0,
      allocationCents: parseChfToCents(allocations[pot.id] ?? "") ?? 0,
      exceptional: exceptional[pot.id] ?? false
    }));
    try {
      return calculateWealthFirstDistribution({
        bankBalanceCents: balanceCents,
        previousBufferCents: settings.current_buffer_cents,
        taxRateBasisPoints: settings.tax_rate_basis_points,
        warningThresholdCents: settings.warning_threshold_cents,
        pots: normalized
      });
    } catch { return null; }
  }, [balanceCents, pots, already, allocations, exceptional, settings]);

  const unapprovedExcess = calculation?.pots.some((pot) => pot.exceedsRemainingTarget && !pot.exceptional) ?? false;
  const canConfirm = Boolean(calculation && !calculation.reconciliationRequired && calculation.shortageCents === 0 && calculation.reconciles && !unapprovedExcess && requestId);

  const confirm = () => {
    if (!calculation || balanceCents === null || !canConfirm) return;
    run(async () => {
      const result = await confirmWealthFirstDistribution({
        buchhaltungId: buchhaltung.id,
        idempotencyKey: requestId,
        distributionMonth: month,
        bankBalanceCents: balanceCents,
        expectedBufferCents: settings.current_buffer_cents,
        expectedSettingsVersion: settings.version,
        allocations: calculation.pots.map((pot) => ({ potId: pot.potId, allocationCents: pot.allocationCents, exceptional: Boolean(pot.exceptional) }))
      });
      onResult(result);
      if (result.error) setRequestId(crypto.randomUUID());
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
          <Field label="Verteilungsmonat"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
          <Field label="Aktueller Kontostand Einnahmenkonto (CHF)" hint="Vollständiger tatsächlicher Bankstand inklusive Business-Puffer."><Input value={bankBalance} inputMode="decimal" placeholder="0.00" onChange={(event) => setBankBalance(event.target.value)} /></Field>
        </div>
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">Annahme: Der Kontostand besteht aus dem zuletzt bestätigten Business-Puffer und neuen, noch unverteilten Eingängen. Frühere Überweisungen, Entnahmen, Rückerstattungen oder nicht zuordenbare Einzahlungen müssen vor der Bestätigung abgestimmt werden.</p>
      </Card>

      {calculation?.reconciliationRequired ? (
        <Card className="space-y-4 border-rose-200 bg-rose-50">
          <div><h2 className="font-semibold text-rose-800">Abstimmung erforderlich</h2><p className="mt-1 text-sm leading-6 text-rose-700">Der Kontostand ist niedriger als der gespeicherte Business-Puffer. Bitte prüfe zwischenzeitliche Kontobewegungen. Es werden weder negative Einnahmen noch negative Steuerrücklagen berechnet.</p></div>
          <ReconciliationFields type={reconciliationType} setType={setReconciliationType} reason={reconciliationReason} setReason={setReconciliationReason} />
          <div className="flex items-center justify-between gap-4"><p className="text-sm text-slate-700">Explizite Pufferkorrektur: {signedMoney((balanceCents ?? 0) - settings.current_buffer_cents)}</p><Button type="button" variant="danger" disabled={pending || reconciliationReason.trim().length < 5} onClick={reconcile}>Kontostand abstimmen</Button></div>
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
            </div>
          </Card>

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 3 · Spartöpfe</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Monatsziele verteilen</h2></div>
            <div className="space-y-3">
              {calculation.pots.map((pot) => (
                <div key={pot.potId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1.2fr_repeat(4,minmax(8rem,1fr))] lg:items-center dark:bg-slate-900">
                  <div><p className="font-medium text-slate-950">{pot.name}</p><p className="text-xs text-slate-500">Monatsziel {formatChfCents(pot.monthlyTargetCents)}</p></div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Bereits zugewiesen</span>{formatChfCents(pot.alreadyAllocatedCents)}</div>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Noch offen</span>{formatChfCents(pot.remainingTargetCents)}</div>
                  <Field label="Aktuelle Zuweisung (CHF)"><Input value={allocations[pot.potId] ?? ""} inputMode="decimal" onChange={(event) => setAllocations((current) => ({ ...current, [pot.potId]: event.target.value }))} /></Field>
                  <div className="text-sm"><span className="block text-xs text-slate-500">Nach Bestätigung</span>{formatChfCents(pot.expectedTotalCents)}</div>
                  {pot.exceedsRemainingTarget ? <label className="lg:col-start-4 lg:col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><input type="checkbox" checked={Boolean(exceptional[pot.potId])} onChange={(event) => setExceptional((current) => ({ ...current, [pot.potId]: event.target.checked }))} />Ausnahme bestätigen: Diese Zuweisung liegt über dem offenen Monatsziel.</label> : null}
                </div>
              ))}
            </div>
            {calculation.shortageCents > 0 ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><strong>Fehlbetrag: {formatChfCents(calculation.shortageCents)}</strong><p className="mt-1">Reduziere oder verschiebe einzelne Zuweisungen. Es wird keine Priorität automatisch festgelegt.</p></div> : null}
          </Card>

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 4 · Überweisungsübersicht</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Manuell auszuführende Verteilung</h2></div>
            <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-4 dark:bg-slate-900">
              <div className="flex justify-between gap-4 py-3"><span>Steuerkonto</span><strong>{formatChfCents(calculation.taxReserveCents)}</strong></div>
              {calculation.pots.map((pot) => <div key={pot.potId} className="flex justify-between gap-4 py-3"><span>{pot.name} <small className="text-slate-500">(logische Zuweisung)</small></span><strong>{formatChfCents(pot.allocationCents)}</strong></div>)}
              <div className="flex justify-between gap-4 py-3"><span>Einnahmenkonto · verbleibender Business-Puffer</span><strong>{formatChfCents(Math.max(0, calculation.resultingBufferCents))}</strong></div>
            </div>
            {calculation.bufferWarning ? <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><strong>Warnung:</strong> Der neue Business-Puffer liegt unter {formatChfCents(settings.warning_threshold_cents)}. Die Bestätigung bleibt möglich.</div> : null}
            <div className={`rounded-2xl border p-4 text-sm ${calculation.reconciles ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{calculation.reconciles ? `Auf den Rappen abgestimmt: ${formatChfCents(calculation.taxReserveCents)} + ${formatChfCents(calculation.allocationTotalCents)} + ${formatChfCents(calculation.resultingBufferCents)} = ${formatChfCents(balanceCents ?? 0)}` : "Die Beträge stimmen nicht exakt. Eine Bestätigung ist gesperrt."}</div>
          </Card>

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Schritt 5 · Bestätigung</p><h2 className="mt-2 text-lg font-semibold text-slate-950">Verteilung verbindlich speichern</h2><p className="mt-2 text-sm text-slate-600">Erst dieser Schritt speichert den unveränderlichen Snapshot und aktualisiert den Puffer atomar. Banküberweisungen werden nicht ausgeführt.</p></div>
            <div className="flex justify-end"><Button type="button" disabled={!canConfirm || pending} onClick={confirm}>{pending ? "Wird bestätigt …" : "Verteilung abschliessen"}</Button></div>
          </Card>

          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:bg-slate-900">
            <summary className="cursor-pointer font-medium text-slate-950">Andere Kontobewegung vor der Verteilung abstimmen</summary>
            <div className="mt-4 space-y-4"><p className="text-sm leading-6 text-slate-600">Nutze dies nur, wenn der Unterschied ausdrücklich keine neu zu versteuernde Einnahme darstellt, zum Beispiel wegen einer Entnahme, Rückerstattung, früheren Überweisung oder nicht zuordenbaren Einzahlung. Die Abstimmung wird separat protokolliert und setzt den gespeicherten Puffer auf den eingegebenen Bankstand.</p><ReconciliationFields type={reconciliationType} setType={setReconciliationType} reason={reconciliationReason} setReason={setReconciliationReason} /><Button type="button" variant="secondary" disabled={pending || reconciliationReason.trim().length < 5} onClick={reconcile}>Abstimmung separat speichern</Button></div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function ReconciliationFields({ type, setType, reason, setReason }: { type: "withdrawal" | "refund" | "deposit" | "transfer" | "other"; setType: (value: "withdrawal" | "refund" | "deposit" | "transfer" | "other") => void; reason: string; setReason: (value: string) => void }) {
  return <div className="grid gap-4 md:grid-cols-2"><Field label="Art der Abweichung"><Select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="withdrawal">Entnahme</option><option value="refund">Rückerstattung</option><option value="deposit">Nicht zuordenbare Einzahlung</option><option value="transfer">Frühere Überweisung</option><option value="other">Andere Kontobewegung</option></Select></Field><Field label="Begründung" hint="Mindestens 5 Zeichen; bleibt in der Abstimmungshistorie erhalten."><Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field></div>;
}

function History({ distributions, reconciliations }: { distributions: WealthFirstDistribution[]; reconciliations: WealthFirstReconciliation[] }) {
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div><h2 className="text-lg font-semibold text-slate-950">Abgeschlossene Verteilungen</h2><p className="text-sm text-slate-600">Unveränderliche Berechnungs-, Einstellungs- und Topf-Snapshots.</p></div>
        {distributions.length ? distributions.map((distribution) => (
          <details key={distribution.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:bg-slate-900">
            <summary className="cursor-pointer list-none"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><div><span className="block text-xs text-slate-500">Bestätigt</span>{dateTimeLabel(distribution.confirmed_at)}</div><div><span className="block text-xs text-slate-500">Verteilungsmonat</span>{monthLabel(distribution.distribution_month)}</div><div><span className="block text-xs text-slate-500">Kontostand</span>{formatChfCents(distribution.bank_balance_cents)}</div><div><span className="block text-xs text-slate-500">Steuerrücklage</span>{formatChfCents(distribution.tax_reserve_cents)}</div><div><span className="block text-xs text-slate-500">Zuweisungen</span>{formatChfCents(distribution.allocation_total_cents)}</div><div><span className="block text-xs text-slate-500">Neuer Puffer</span>{formatChfCents(distribution.resulting_buffer_cents)}</div></div></summary>
            <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Alter Puffer" value={formatChfCents(distribution.previous_buffer_cents)} /><Metric label="Neue Einnahmen" value={formatChfCents(distribution.new_receipts_cents)} /><Metric label={`Steuersatz ${(distribution.tax_rate_basis_points_snapshot / 100).toFixed(2)} %`} value={formatChfCents(distribution.tax_reserve_cents)} /><Metric label="Pufferveränderung" value={signedMoney(distribution.buffer_change_cents)} /></div>
              <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="px-3 py-2">Spartopf-Snapshot</th><th className="px-3 py-2">Monatsziel</th><th className="px-3 py-2">Vorher</th><th className="px-3 py-2">Zuweisung</th><th className="px-3 py-2">Danach</th></tr></thead><tbody>{(distribution.allocations ?? []).map((allocation) => <tr key={allocation.id} className="border-t border-slate-200"><td className="px-3 py-2">{allocation.pot_name_snapshot}{allocation.exceptional ? " · Ausnahme" : ""}</td><td className="px-3 py-2">{formatChfCents(allocation.monthly_target_cents_snapshot)}</td><td className="px-3 py-2">{formatChfCents(allocation.already_allocated_cents_snapshot)}</td><td className="px-3 py-2">{formatChfCents(allocation.allocation_cents)}</td><td className="px-3 py-2">{formatChfCents(allocation.expected_month_total_cents)}</td></tr>)}</tbody></table></div>
              <p className="text-xs text-slate-500">Einstellungsstand {distribution.settings_version_snapshot} · Warnschwelle {formatChfCents(distribution.warning_threshold_cents_snapshot)}</p>
            </div>
          </details>
        )) : <p className="text-sm text-slate-600">Noch keine bestätigte Verteilung.</p>}
      </Card>
      <Card className="space-y-4"><div><h2 className="text-lg font-semibold text-slate-950">Puffer-Abstimmungen</h2><p className="text-sm text-slate-600">Separat von Buchhaltung und Verteilungen protokolliert.</p></div>{reconciliations.length ? reconciliations.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:bg-slate-900"><div className="grid gap-3 md:grid-cols-4"><div><span className="block text-xs text-slate-500">Zeitpunkt</span>{dateTimeLabel(item.confirmed_at)}</div><div><span className="block text-xs text-slate-500">Vorher</span>{formatChfCents(item.previous_buffer_cents)}</div><div><span className="block text-xs text-slate-500">Korrektur</span>{signedMoney(item.adjustment_cents)}</div><div><span className="block text-xs text-slate-500">Danach</span>{formatChfCents(item.resulting_buffer_cents)}</div></div><p className="mt-3 text-slate-700">{item.reason}</p></div>) : <p className="text-sm text-slate-600">Keine Abstimmungen protokolliert.</p>}</Card>
    </div>
  );
}
