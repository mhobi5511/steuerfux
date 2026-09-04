"use client";

import { useMemo, useState, useTransition } from "react";
import { saveMileageYearSettings } from "@/app/actions/finance";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Buchhaltung, MileageYearSetting } from "@/lib/db-types";
import { getDefaultMileageRate } from "@/lib/mileage";

export function MileageSettingsForm({
  activeBuchhaltung,
  settings,
  initialYear
}: {
  activeBuchhaltung: Buchhaltung | null;
  settings: MileageYearSetting[];
  initialYear: number;
}) {
  const [pending, startTransition] = useTransition();
  const [year, setYear] = useState(initialYear);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => settings.find((setting) => setting.year === year),
    [settings, year]
  );
  const suggestedRate = activeBuchhaltung
    ? getDefaultMileageRate(activeBuchhaltung.country, year)
    : null;
  const displayedRate = selected?.mileage_rate ?? suggestedRate;

  if (!activeBuchhaltung) return null;

  return (
    <Card id="kilometersatz" className="space-y-5 scroll-mt-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">Fahrten &amp; Kilometer</h2>
        <p className="text-sm leading-6 text-slate-600">
          Dieser Kilometersatz wird für geschäftlich gefahrene Kilometer dieser Buchhaltung im
          ausgewählten Jahr verwendet. Bereits gespeicherte Fahrten werden nicht neu berechnet.
        </p>
      </div>
      <form
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await saveMileageYearSettings(formData);
            if (result.error) setError(result.error);
            if (result.success) setSuccess(result.success);
          })
        }
        className="grid gap-4 lg:grid-cols-3"
      >
        <Field label="Abrechnungsjahr">
          <Input
            name="year"
            type="number"
            min="2020"
            max="2100"
            required
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value));
              setError(null);
              setSuccess(null);
            }}
          />
        </Field>
        <Field
          label="Kilometersatz"
          hint={selected ? "Individuell gespeichert" : "Vorgeschlagener Standardwert"}
        >
          <Input
            key={`${year}-${displayedRate ?? "unset"}`}
            name="mileage_rate"
            type="number"
            min="0"
            step="0.0001"
            required
            defaultValue={displayedRate ?? ""}
            placeholder={displayedRate === null ? "Bitte festlegen" : undefined}
          />
        </Field>
        <Field label="Währung">
          <Input
            name="mileage_currency"
            value={activeBuchhaltung.reporting_currency}
            readOnly
          />
        </Field>
        <div className="lg:col-span-3">
          <FormFeedback error={error} success={success} />
        </div>
        <div className="lg:col-span-3 flex justify-end">
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Speichern..." : "Kilometersatz speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
