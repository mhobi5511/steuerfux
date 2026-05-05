"use client";

import { useRef, useState, useTransition } from "react";
import { upsertReimbursement } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  reimbursementContextOptions,
  reimbursementStatusOptions
} from "@/lib/constants";
import type { CurrencyCode, TaxMode } from "@/lib/db-types";

export function ReimbursementForm({
  fallbackRate,
  defaultCurrency,
  defaultTaxMode
}: {
  fallbackRate: number;
  defaultCurrency: CurrencyCode;
  defaultTaxMode: TaxMode;
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
        <h2 className="text-lg font-semibold text-slate-950">Neuer Zuschuss</h2>
        <p className="hidden text-sm text-slate-600">
          Zuschüsse und Erstattungen werden getrennt von normalen Einnahmen dokumentiert, damit offene und bezahlte Rückerstattungen sauber sichtbar bleiben.
        </p>
      </div>

      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertReimbursement(formData);
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
        <Field label="Datum">
          <Input name="reimbursement_date" type="date" required />
        </Field>
        <Field label="Beschreibung">
          <Input name="description" required placeholder="z. B. Parkticket an Kunden weiterberechnet" />
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
        <Field label="Netto oder Brutto">
          <Select name="tax_mode" defaultValue={defaultTaxMode}>
            <option value="NETTO">NETTO</option>
            <option value="BRUTTO">BRUTTO</option>
          </Select>
        </Field>
        <Field label="Zusammenhang">
          <Select name="context_type" defaultValue={reimbursementContextOptions[2]}>
            {reimbursementContextOptions.map((context) => (
              <option key={context} value={context}>
                {context}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Optional verknüpfter Datensatz">
          <Input name="linked_record_id" placeholder="UUID optional" />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={reimbursementStatusOptions[0]}>
            {reimbursementStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>

        <div className="lg:col-span-2">
          <ExchangeRateInput dateName="reimbursement_date" fallbackRate={fallbackRate} />
        </div>

        <Field label="Notiz">
          <Textarea name="note" />
        </Field>

        <div className="lg:col-span-2">
          <FormFeedback error={error} success={success} />
        </div>

        <div className="lg:col-span-2 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Speichern..." : "Zuschuss speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
