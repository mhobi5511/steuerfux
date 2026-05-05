"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { upsertExpense } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { MoneyPreview } from "@/components/forms/money-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getDepreciationSuggestion } from "@/lib/depreciation";
import type { BusinessCountry, CurrencyCode, ReportingCurrency, TaxMode } from "@/lib/db-types";

export function ExpenseForm({
  fallbackRate,
  reportingCurrency,
  defaultCurrency,
  defaultTaxMode,
  businessCountry
}: {
  fallbackRate: number;
  reportingCurrency: ReportingCurrency;
  defaultCurrency: CurrencyCode;
  defaultTaxMode: TaxMode;
  businessCountry: BusinessCountry;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [rate, setRate] = useState(1);
  const [deductiblePercentage, setDeductiblePercentage] = useState(100);
  const [category, setCategory] = useState("");
  const [isDepreciable, setIsDepreciable] = useState("false");
  const [reimbursableToClient, setReimbursableToClient] = useState("false");
  const [clientShareMode, setClientShareMode] = useState<"fixed" | "percentage">("fixed");
  const [clientSharePercentage, setClientSharePercentage] = useState(0);
  const [clientShareFixedAmount, setClientShareFixedAmount] = useState(0);
  const [clientShareFixedCurrency, setClientShareFixedCurrency] =
    useState<CurrencyCode>(defaultCurrency);
  const [clientShareFixedRate, setClientShareFixedRate] = useState(1);

  const preview = useMemo(() => {
    const amountReporting =
      currency === reportingCurrency
        ? amount
        : reportingCurrency === "EUR"
          ? amount * rate
          : amount / rate;
    const fixedClientShareReporting =
      clientShareFixedCurrency === reportingCurrency
        ? clientShareFixedAmount
        : reportingCurrency === "EUR"
          ? clientShareFixedAmount * clientShareFixedRate
          : clientShareFixedAmount / clientShareFixedRate;
    const clientShareReporting =
      reimbursableToClient !== "true"
        ? 0
        : clientShareMode === "fixed"
          ? fixedClientShareReporting
          : amountReporting * (clientSharePercentage / 100);
    const deductibleReporting = amountReporting * (deductiblePercentage / 100);
    return {
      amountReporting,
      clientShareReporting,
      deductibleReporting,
      effectiveReporting: amountReporting - clientShareReporting,
      effectiveDeductibleReporting: Math.max(deductibleReporting - clientShareReporting, 0)
    };
  }, [
    amount,
    clientShareFixedAmount,
    clientShareFixedCurrency,
    clientShareFixedRate,
    clientShareMode,
    clientSharePercentage,
    currency,
    deductiblePercentage,
    rate,
    reimbursableToClient,
    reportingCurrency
  ]);

  const suggestion = useMemo(
    () => getDepreciationSuggestion(businessCountry, preview.amountReporting, category || "Allgemein"),
    [businessCountry, preview.amountReporting, category]
  );

  function resetForm() {
    formRef.current?.reset();
    setAmount(0);
    setCurrency(defaultCurrency);
    setRate(1);
    setDeductiblePercentage(100);
    setCategory("");
    setIsDepreciable("false");
    setReimbursableToClient("false");
    setClientShareMode("fixed");
    setClientSharePercentage(0);
    setClientShareFixedAmount(0);
    setClientShareFixedCurrency(defaultCurrency);
    setClientShareFixedRate(1);
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-950">Neue Ausgabe</h2>
        <p className="text-sm text-slate-600">
          Standardfälle brauchen nur Datum, Beschreibung, Betrag und Währung. Alles Weitere ist optional.
        </p>
      </div>

      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertExpense(formData);
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
        <Field label="Zahlungsdatum">
          <Input name="payment_date" type="date" required />
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
        <Field label="Beschreibung">
          <Input name="description" required placeholder="z. B. Parkticket Pilatus Arena" />
        </Field>
        <Field label="Originalbetrag">
          <Input
            name="original_amount"
            type="number"
            step="0.01"
            required
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </Field>

        {currency !== reportingCurrency ? (
          <div
            className="lg:col-span-2"
            onChange={(event) => {
              const target = event.target as HTMLInputElement;
              if (target.name === "exchange_rate") setRate(Number(target.value));
              if (target.name === "client_share_fixed_exchange_rate") {
                setClientShareFixedRate(Number(target.value));
              }
            }}
          >
            <ExchangeRateInput
              dateName="payment_date"
              fallbackRate={fallbackRate}
              label={`Wechselkurs für ${currency} -> ${reportingCurrency}`}
            />
          </div>
        ) : (
          <>
            <input name="exchange_rate" type="hidden" value="1" />
            <input name="exchange_rate_manual" type="hidden" value="false" />
          </>
        )}

        <input name="tax_mode" type="hidden" value={defaultTaxMode} />

        <details className="lg:col-span-2 rounded-2xl border border-line bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            Mehr Optionen
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Kategorie optional">
              <Input
                name="category"
                placeholder="z. B. Technik, Software, Reisen"
                onChange={(event) => setCategory(event.target.value)}
              />
            </Field>
            <Field label="Steuerlich absetzbar?">
              <Select
                name="deductible"
                defaultValue="true"
                onChange={(event) =>
                  setDeductiblePercentage(event.target.value === "true" ? 100 : 0)
                }
              >
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </Select>
            </Field>
            <Field label="Absetzbarer Anteil in %">
              <Input
                name="deductible_percentage"
                type="number"
                min="0"
                max="100"
                defaultValue={100}
                onChange={(event) => setDeductiblePercentage(Number(event.target.value))}
              />
            </Field>
            <Field label="Beleg vorhanden?">
              <Select name="receipt_available" defaultValue="true">
                <option value="true">Ja</option>
                <option value="false">Nein</option>
              </Select>
            </Field>
            <Field label="Kann an Kunden weiterberechnet werden?">
              <Select
                name="reimbursable_to_client"
                value={reimbursableToClient}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setReimbursableToClient(nextValue);
                  if (nextValue !== "true") {
                    setClientSharePercentage(0);
                    setClientShareFixedAmount(0);
                  }
                }}
              >
                <option value="false">Nein</option>
                <option value="true">Ja</option>
              </Select>
            </Field>
            {reimbursableToClient === "true" ? (
              <>
                <Field label="Art der Kundenbeteiligung">
                  <Select
                    name="client_share_mode"
                    value={clientShareMode}
                    onChange={(event) =>
                      setClientShareMode(event.target.value as "fixed" | "percentage")
                    }
                  >
                    <option value="fixed">Fixbetrag</option>
                    <option value="percentage">Prozentual</option>
                  </Select>
                </Field>
                {clientShareMode === "percentage" ? (
                  <Field label="Kundenbeteiligung in %">
                    <Input
                      name="client_share_percentage"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={clientSharePercentage}
                      onChange={(event) => setClientSharePercentage(Number(event.target.value))}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Fixe Kundenbeteiligung">
                      <Input
                        name="client_share_fixed_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={clientShareFixedAmount}
                        onChange={(event) => setClientShareFixedAmount(Number(event.target.value))}
                      />
                    </Field>
                    <Field label="Währung der Kundenbeteiligung">
                      <Select
                        name="client_share_fixed_currency"
                        value={clientShareFixedCurrency}
                        onChange={(event) =>
                          setClientShareFixedCurrency(event.target.value as CurrencyCode)
                        }
                      >
                        <option value="EUR">EUR</option>
                        <option value="CHF">CHF</option>
                      </Select>
                    </Field>
                  </>
                )}
              </>
            ) : (
              <>
                <input name="reimbursable_to_client" type="hidden" value="false" />
                <input name="client_share_mode" type="hidden" value="fixed" />
                <input name="client_share_percentage" type="hidden" value="0" />
                <input name="client_share_fixed_amount" type="hidden" value="0" />
                <input
                  name="client_share_fixed_currency"
                  type="hidden"
                  value={clientShareFixedCurrency}
                />
              </>
            )}
            <Field label="Notiz" hint="Optional für besondere Fälle oder Begründungen.">
              <Textarea name="note" />
            </Field>
          </div>
        </details>

        {clientShareMode === "fixed" && reimbursableToClient === "true" ? (
          <div className="lg:col-span-2">
            {clientShareFixedCurrency === reportingCurrency ? (
              <>
                <input name="client_share_fixed_exchange_rate" type="hidden" value="1" />
                <input name="client_share_fixed_exchange_rate_manual" type="hidden" value="false" />
              </>
            ) : (
              <ExchangeRateInput
                dateName="payment_date"
                rateName="client_share_fixed_exchange_rate"
                manualName="client_share_fixed_exchange_rate_manual"
                fallbackRate={fallbackRate}
                defaultRate={clientShareFixedRate}
                label={`Wechselkurs für Kundenbeteiligung (${clientShareFixedCurrency} -> ${reportingCurrency})`}
                hint="Nur nötig, wenn der feste Kundenanteil in einer Fremdwährung erfasst wird."
              />
            )}
          </div>
        ) : (
          <>
            <input name="client_share_fixed_exchange_rate" type="hidden" value="1" />
            <input name="client_share_fixed_exchange_rate_manual" type="hidden" value="false" />
          </>
        )}

        <details className="lg:col-span-2 rounded-2xl border border-line bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            Abschreibung prüfen
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <Field label="Als Abschreibung behandeln?">
              <Select
                name="is_depreciable"
                value={isDepreciable}
                onChange={(event) => setIsDepreciable(event.target.value)}
              >
                <option value="false">Nein</option>
                <option value="true">Ja</option>
              </Select>
            </Field>
            <Field label="Anschaffungswert">
              <Input name="acquisition_value" type="number" step="0.01" />
            </Field>
            <Field label="Anschaffungsdatum">
              <Input name="acquisition_date" type="date" />
            </Field>
            <Field label="Nutzungsdauer in Jahren">
              <Input
                name="useful_life_years"
                type="number"
                min="1"
                defaultValue={suggestion.defaultUsefulLifeYears}
              />
            </Field>
            <input name="depreciation_method" type="hidden" value="linear" />
            {suggestion.warning ? (
              <div className="lg:col-span-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {suggestion.warning}
              </div>
            ) : null}
          </div>
        </details>

        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
          <MoneyPreview
            value={preview.amountReporting}
            currency={reportingCurrency}
            title={`Betrag in Berichtswährung (${reportingCurrency})`}
            description="Wird aus Originalbetrag, Währung und Wechselkurs berechnet."
          />
          <MoneyPreview
            value={preview.clientShareReporting}
            currency={reportingCurrency}
            title="Kundenbeteiligung"
            description="Bleibt 0, wenn nichts weiterberechnet wird."
          />
          <MoneyPreview
            value={preview.effectiveReporting}
            currency={reportingCurrency}
            title="Effektive Kosten"
            description="So stark belastet die Ausgabe dein Unternehmen."
          />
          <MoneyPreview
            value={preview.effectiveDeductibleReporting}
            currency={reportingCurrency}
            title="Steuerlich absetzbarer Betrag"
            description="Nach Kundenbeteiligung bleibt dieser Betrag steuerlich relevant."
          />
        </div>

        <div className="lg:col-span-2">
          <FormFeedback error={error} success={success} />
        </div>

        <div className="lg:col-span-2 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Speichern..." : "Ausgabe speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
