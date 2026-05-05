"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { upsertIncome } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { MoneyPreview } from "@/components/forms/money-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CurrencyCode, Income, ReportingCurrency, TaxMode } from "@/lib/db-types";
import { formatCurrency } from "@/lib/utils";

export function IncomeForm({
  fallbackRate,
  reportingCurrency,
  defaultCurrency,
  defaultTaxMode,
  initialValues
}: {
  fallbackRate: number;
  reportingCurrency: ReportingCurrency;
  defaultCurrency: CurrencyCode;
  defaultTaxMode: TaxMode;
  initialValues?: Income | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState(initialValues?.invoice_amount_original ?? 0);
  const [paymentAmount, setPaymentAmount] = useState(initialValues?.payment_received_original ?? 0);
  const [currency, setCurrency] = useState<CurrencyCode>(initialValues?.currency ?? defaultCurrency);
  const [rate, setRate] = useState(initialValues?.exchange_rate ?? 1);
  const [paymentDate, setPaymentDate] = useState(initialValues?.payment_date ?? "");

  const preview = useMemo(() => {
    const hasPaymentDate = Boolean(paymentDate);
    const effectivePaymentAmount = hasPaymentDate
      ? paymentAmount > 0
        ? paymentAmount
        : invoiceAmount
      : 0;
    const converted = (amount: number) =>
      currency === reportingCurrency
        ? amount
        : reportingCurrency === "EUR"
          ? amount * rate
          : amount / rate;
    const invoiceReporting = converted(invoiceAmount);
    const paymentReporting = converted(effectivePaymentAmount);
    const difference = invoiceReporting - paymentReporting;

    return {
      invoiceReporting,
      paymentReporting,
      difference,
      effectivePaymentAmount,
      hasPaymentDate
    };
  }, [currency, invoiceAmount, paymentAmount, paymentDate, rate, reportingCurrency]);

  function resetForm() {
    formRef.current?.reset();
    setInvoiceAmount(0);
    setPaymentAmount(0);
    setCurrency(defaultCurrency);
    setRate(1);
    setPaymentDate("");
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">
          {initialValues?.id ? "Einnahme bearbeiten" : "Neue Einnahme"}
        </h2>
        <p className="text-sm text-slate-600">
          Fulle nur das Nötigste aus. Die App leitet Status, Differenzen und mögliche Bankgebühren automatisch ab.
        </p>
      </div>

      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertIncome(formData);
            if (result.success) {
              if (initialValues?.id) {
                router.push("/einnahmen");
                router.refresh();
                return;
              }

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
        {initialValues?.id ? <input name="id" type="hidden" value={initialValues.id} /> : null}
        <Field label="Rechnungsdatum">
          <Input
            name="invoice_date"
            type="date"
            required
            defaultValue={initialValues?.invoice_date ?? ""}
          />
        </Field>
        <Field label="Zahlungsdatum optional">
          <Input
            name="payment_date"
            type="date"
            defaultValue={initialValues?.payment_date ?? ""}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </Field>
        <Field label="Kunde / Projekt">
          <Input
            name="customer_project"
            required
            placeholder="z. B. Pilatus Arena"
            defaultValue={initialValues?.customer_project ?? ""}
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
        <Field label="Rechnungsbetrag">
          <Input
            name="invoice_amount_original"
            type="number"
            step="0.01"
            required
            defaultValue={initialValues?.invoice_amount_original ?? ""}
            onChange={(event) => setInvoiceAmount(Number(event.target.value))}
          />
        </Field>
        <Field
          label="Effektiv erhalten optional"
          hint="Wird nur berücksichtigt, wenn ein Zahlungsdatum gesetzt ist. Ohne Zahlungsdatum bleibt die Rechnung offen."
        >
          <Input
            name="payment_received_original"
            type="number"
            step="0.01"
            defaultValue={initialValues?.payment_received_original ?? ""}
            onChange={(event) => setPaymentAmount(Number(event.target.value))}
          />
        </Field>

        {currency !== reportingCurrency ? (
          <div
            onChange={(event) => {
              const target = event.target as HTMLInputElement;
              if (target.name === "exchange_rate") {
                setRate(Number(target.value));
              }
            }}
            className="lg:col-span-2"
          >
            <ExchangeRateInput
              dateName="payment_date"
              fallbackRate={fallbackRate}
              defaultRate={initialValues?.exchange_rate ?? 1}
              label={`Wechselkurs für ${currency} -> ${reportingCurrency}`}
            />
          </div>
        ) : (
          <>
            <input name="exchange_rate" type="hidden" value="1" />
            <input
              name="exchange_rate_manual"
              type="hidden"
              value={initialValues?.exchange_rate_manual ? "true" : "false"}
            />
          </>
        )}

        <input name="tax_mode" type="hidden" value={initialValues?.tax_mode ?? defaultTaxMode} />

        <details className="lg:col-span-2 rounded-2xl border border-line bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            Mehr Optionen
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Kategorie optional">
              <Input
                name="category"
                placeholder="z. B. Show, Probe, Workshop"
                defaultValue={initialValues?.category ?? ""}
              />
            </Field>
            <Field label="Beschreibung / Notiz">
              <Textarea
                name="description"
                placeholder="Optional, z. B. Rechnung über LED Drumshow in CHF."
                defaultValue={initialValues?.description ?? ""}
              />
            </Field>
          </div>
        </details>

        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-3">
          <MoneyPreview
            value={preview.invoiceReporting}
            currency={reportingCurrency}
            title={`Betrag in Berichtswährung (${reportingCurrency})`}
            description="Zur Kontrolle vor dem Speichern."
          />
          <MoneyPreview
            value={preview.paymentReporting}
            currency={reportingCurrency}
            title={`Zahlung in Berichtswährung (${reportingCurrency})`}
            description={
              preview.hasPaymentDate && preview.effectivePaymentAmount > 0
                ? "Wird für Gewinn, Zahlungseingänge und Bankgebühren verwendet."
                : "Ohne Zahlungsdatum bleibt die Einnahme offen und fließt nicht in Zahlungseingänge oder Bankgebühren ein."
            }
          />
          <Card
            className={
              preview.hasPaymentDate && preview.difference > 0
                ? "border-amber-300 bg-amber-50"
                : "border-emerald-200 bg-emerald-50"
            }
          >
            <p className="text-sm text-slate-500">Differenz in Berichtswährung</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {formatCurrency(preview.difference, reportingCurrency)}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Nur bezahlte Einnahmen mit Zahlungsdatum können automatisch als Bank- oder Zahlungsdifferenz gespiegelt werden.
            </p>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <FormFeedback error={error} success={success} />
        </div>

        <div className="lg:col-span-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {initialValues?.id ? (
            <Link
              href="/einnahmen"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 md:min-h-10 md:py-2"
            >
              Bearbeitung beenden
            </Link>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending
              ? "Speichern..."
              : initialValues?.id
                ? "Einnahme aktualisieren"
                : "Einnahme speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
