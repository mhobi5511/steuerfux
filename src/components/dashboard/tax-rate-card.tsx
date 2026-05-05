"use client";

import { useMemo, useState, useTransition } from "react";
import { saveEstimatedTaxRate } from "@/app/actions/finance";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ReportingCurrency } from "@/lib/db-types";
import { formatCurrency } from "@/lib/utils";

export function TaxRateCard({
  initialTaxRate,
  taxableProfit,
  reportingCurrency
}: {
  initialTaxRate: number;
  taxableProfit: number;
  reportingCurrency: ReportingCurrency;
}) {
  const [pending, startTransition] = useTransition();
  const [taxRate, setTaxRate] = useState(String(initialTaxRate));
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const estimatedPayment = useMemo(() => {
    const rate = Number(String(taxRate).replace(",", "."));
    if (!Number.isFinite(rate)) return 0;
    return (Math.max(taxableProfit, 0) * Math.max(rate, 0)) / 100;
  }, [taxRate, taxableProfit]);

  return (
    <Card className="space-y-4 rounded-[2rem] bg-slate-100/80 dark:bg-slate-900">
      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-slate-400">
        Geschätzte Steuerzahlung
      </p>
      <p className="text-[1.85rem] font-semibold tracking-[-0.03em] text-slate-950 sm:text-2xl">
        {formatCurrency(estimatedPayment, reportingCurrency)}
      </p>
      <p className="text-sm leading-6 text-slate-500">
        Steuersatz auf Basis des steuerlich relevanten Gewinns.
      </p>

      <form
        action={(formData) =>
          startTransition(async () => {
            setSuccess(null);
            setError(null);
            const result = await saveEstimatedTaxRate(formData);
            if (result.success) setSuccess(result.success);
            if (result.error) setError(result.error);
          })
        }
        className="space-y-3"
      >
        <label className="block text-sm font-medium text-slate-900">
          Steuersatz in %
          <Input
            className="mt-2"
            name="estimated_tax_rate"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Speichern..." : "Steuersatz speichern"}
        </Button>
        <FormFeedback error={error} success={success} />
      </form>
    </Card>
  );
}
