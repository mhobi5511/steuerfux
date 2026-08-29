"use client";

import { useState, useTransition } from "react";
import {
  closeBuchhaltung,
  createBuchhaltung,
  reopenBuchhaltung,
  selectBuchhaltung
} from "@/app/actions/finance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Buchhaltung, BusinessCountry, ReportingCurrency } from "@/lib/db-types";

export function BuchhaltungSelector({
  buchhaltungen,
  activeBuchhaltung
}: {
  buchhaltungen: Buchhaltung[];
  activeBuchhaltung: Buchhaltung | null;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"none" | "close" | "create">("none");
  const [country, setCountry] = useState<BusinessCountry>("Deutschland");
  const [reportingCurrency, setReportingCurrency] =
    useState<ReportingCurrency>("EUR");

  return (
    <div className="space-y-3 rounded-[1.35rem] border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <form action={selectBuchhaltung} className="space-y-2">
        <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
          Aktuelle Buchhaltung
        </label>
        <Select
          name="buchhaltung_id"
          value={activeBuchhaltung?.id ?? ""}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          disabled={pending}
        >
          {buchhaltungen.map((buchhaltung) => (
            <option key={buchhaltung.id} value={buchhaltung.id}>
              {buchhaltung.name} · {buchhaltung.country} · {buchhaltung.status}
            </option>
          ))}
        </Select>
      </form>

      {activeBuchhaltung ? (
        <div className="space-y-1 text-sm text-slate-600">
          <p className="font-medium text-slate-950">{activeBuchhaltung.name}</p>
          <p>
            {activeBuchhaltung.country} · {activeBuchhaltung.reporting_currency} ·{" "}
            {activeBuchhaltung.status}
          </p>
          {activeBuchhaltung.status === "abgeschlossen" ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              Diese Buchhaltung ist abgeschlossen und schreibgeschützt.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setMode("create")}>
          Neue Buchhaltung
        </Button>
        {activeBuchhaltung?.status === "aktiv" ? (
          <Button type="button" variant="ghost" onClick={() => setMode("close")}>
            Abschließen
          </Button>
        ) : activeBuchhaltung ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm("Buchhaltung wirklich wieder öffnen?")) return;
              startTransition(async () => {
                await reopenBuchhaltung();
              });
            }}
          >
            Wieder öffnen
          </Button>
        ) : null}
      </div>

      {mode === "close" ? (
        <form
          action={(formData) =>
            startTransition(async () => {
              await closeBuchhaltung(formData);
              setMode("none");
            })
          }
          className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
        >
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-950">Buchhaltung wirklich abschließen?</h3>
            <p className="text-sm leading-6 text-slate-700">
              Nach dem Abschluss können keine neuen Buchungen mehr hinzugefügt werden. Die
              vorhandenen Daten bleiben vollständig erhalten und können weiterhin angesehen und
              exportiert werden.
            </p>
          </div>
          <Field label="Enddatum">
            <Input name="end_date" type="date" required />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setMode("none")}>
              Abbrechen
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              Abschließen
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "create" ? (
        <form
          action={(formData) =>
            startTransition(async () => {
              await createBuchhaltung(formData);
              setMode("none");
            })
          }
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <Field label="Name">
            <Input name="name" required placeholder="z. B. Einzelfirma" />
          </Field>
          <Field label="Land">
            <Select
              name="country"
              value={country}
              onChange={(event) => {
                const nextCountry = event.target.value as BusinessCountry;
                setCountry(nextCountry);
                setReportingCurrency(nextCountry === "Schweiz" ? "CHF" : "EUR");
              }}
            >
              <option value="Deutschland">Deutschland</option>
              <option value="Schweiz">Schweiz</option>
            </Select>
          </Field>
          <Field label="Berichtswährung">
            <Select
              name="reporting_currency"
              value={reportingCurrency}
              onChange={(event) =>
                setReportingCurrency(event.target.value as ReportingCurrency)
              }
            >
              <option value="EUR">EUR</option>
              <option value="CHF">CHF</option>
            </Select>
          </Field>
          <Field label="Startdatum">
            <Input name="start_date" type="date" required />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setMode("none")}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              Anlegen
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
