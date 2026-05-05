"use client";

import { useRef, useState, useTransition } from "react";
import { upsertBankFee } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { feeTypeOptions } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/db-types";

export function BankFeeForm({
  fallbackRate,
  defaultCurrency
}: {
  fallbackRate: number;
  defaultCurrency: CurrencyCode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);

  function resetForm() {
    formRef.current?.reset();
    setCurrency(defaultCurrency);
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">Neue Gebühr</h2>
        <p className="text-sm text-slate-600">
          Für Gebühren zählt nur ein Datum: das Datum der Gebühr. Dieser Tag wird auch für die Umrechnung in die Berichtswährung verwendet.
        </p>
      </div>
      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertBankFee(formData);
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
        <Field label="Datum der Gebühr">
          <Input name="fee_date" type="date" required />
        </Field>
        <Field label="Originalbetrag">
          <Input name="original_amount" type="number" step="0.01" required />
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
        <Field label="Art der Gebühr">
          <Select name="fee_type" defaultValue={feeTypeOptions[0]}>
            {feeTypeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <div className="lg:col-span-2">
          <ExchangeRateInput dateName="fee_date" fallbackRate={fallbackRate} />
        </div>
        <Field label="Beschreibung optional" hint="Zum Beispiel die Bank, die Transaktion oder der Grund der Differenz.">
          <Textarea name="description" />
        </Field>

        <div className="lg:col-span-2">
          <FormFeedback error={error} success={success} />
        </div>

        <div className="lg:col-span-2 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Speichern..." : "Gebühr speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
