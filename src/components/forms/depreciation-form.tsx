"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { upsertDepreciation } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CurrencyCode } from "@/lib/db-types";

type InitialDepreciation = {
  id?: string;
  description?: string;
  original_amount?: number;
  currency?: CurrencyCode;
  acquisition_date?: string;
  useful_life_years?: number;
  note?: string | null;
  linked_expense_id?: string | null;
  exchange_rate?: number;
};

export function DepreciationForm({
  fallbackRate,
  defaultCurrency,
  initialValues
}: {
  fallbackRate: number;
  defaultCurrency: CurrencyCode;
  initialValues?: InitialDepreciation | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>(initialValues?.currency ?? defaultCurrency);

  function resetForm() {
    formRef.current?.reset();
    setCurrency(defaultCurrency);
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">
          {initialValues?.id ? "Abschreibung bearbeiten" : "Neue Abschreibung"}
        </h2>
        <p className="text-sm text-slate-600">
          Die App rechnet linear und zeigt jährlichen Betrag, bereits abgeschriebenen Anteil und Restwert in der Berichtswährung.
        </p>
      </div>
      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertDepreciation(formData);
            if (result.success) {
              resetForm();
              setSuccess(result.success);
            }
            if (result.error) {
              setError(result.error);
            }
          })
        }
        className="grid gap-4 lg:grid-cols-2"
      >
        {initialValues?.id ? <input type="hidden" name="id" value={initialValues.id} /> : null}
        {initialValues?.linked_expense_id ? (
          <input type="hidden" name="linked_expense_id" value={initialValues.linked_expense_id} />
        ) : null}

        <Field label="Beschreibung">
          <Input
            name="description"
            required
            placeholder="z. B. Instrument, Hardware oder Equipment"
            defaultValue={initialValues?.description ?? ""}
          />
        </Field>
        <Field label="Originalbetrag">
          <Input
            name="original_amount"
            type="number"
            step="0.01"
            required
            defaultValue={initialValues?.original_amount ?? ""}
          />
        </Field>
        <Field label="Originalwährung">
          <Select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
          >
            <option value="EUR">EUR</option>
            <option value="CHF">CHF</option>
          </Select>
        </Field>
        <Field label="Anschaffungsdatum">
          <Input
            name="acquisition_date"
            type="date"
            required
            defaultValue={initialValues?.acquisition_date ?? ""}
          />
        </Field>
        <Field label="Nutzungsdauer in Jahren">
          <Input
            name="useful_life_years"
            type="number"
            min="1"
            required
            defaultValue={initialValues?.useful_life_years ?? ""}
          />
        </Field>
        <div className="lg:col-span-2">
          <ExchangeRateInput
            dateName="acquisition_date"
            fallbackRate={fallbackRate}
            defaultRate={initialValues?.exchange_rate ?? 1}
          />
        </div>
        <Field label="Notiz">
          <Textarea name="note" defaultValue={initialValues?.note ?? ""} />
        </Field>

        <div className="lg:col-span-2">
          <FormFeedback error={error} success={success} />
        </div>

        <div className="lg:col-span-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {initialValues?.id ? (
            <Link
              href="/abschreibungen"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 md:min-h-10 md:py-2"
            >
              Bearbeitung beenden
            </Link>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Speichern..." : "Abschreibung speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
