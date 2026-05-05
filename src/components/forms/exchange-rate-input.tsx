"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ExchangeRateInput({
  dateName,
  rateName = "exchange_rate",
  manualName = "exchange_rate_manual",
  fallbackRate,
  defaultRate = 1,
  label = "Wechselkurs CHF -> EUR",
  hint = "Bei identischer Währung ist 1,00 korrekt. Sonst kannst du den historischen Kurs laden oder manuell überschreiben."
}: {
  dateName: string;
  rateName?: string;
  manualName?: string;
  fallbackRate: number;
  defaultRate?: number;
  label?: string;
  hint?: string;
}) {
  const [rate, setRate] = useState(defaultRate);
  const [warning, setWarning] = useState<string | null>(null);
  const [manual, setManual] = useState(defaultRate !== 1);
  const [pending, startTransition] = useTransition();

  async function loadRate() {
    const input = document.querySelector<HTMLInputElement>(`input[name="${dateName}"]`);
    const date = (input?.value ?? "").split("T")[0] ?? "";

    startTransition(async () => {
      const response = await fetch(`/api/exchange-rate?date=${date}&fallback=${fallbackRate}`);
      const data = (await response.json()) as {
        rate: number;
        warning?: string;
        manualRequired: boolean;
      };

      setRate(data.rate || fallbackRate || 1);
      setManual(Boolean(data.manualRequired));
      setWarning(data.warning ?? null);
    });
  }

  return (
    <div className="grid gap-3">
      <Field label={label} hint={hint}>
        <Input
          name={rateName}
          type="number"
          step="0.00001"
          value={rate}
          onChange={(event) => {
            setRate(Number(event.target.value));
            setManual(true);
          }}
        />
      </Field>
      <input name={manualName} type="hidden" value={manual ? "true" : "false"} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={loadRate} disabled={pending}>
          {pending ? "Kurs wird geladen..." : "Historischen Kurs laden"}
        </Button>
        <span className="text-xs text-slate-500">
          Wenn die Abfrage fehlschlägt, kannst du den Kurs trotzdem manuell eintragen.
        </span>
      </div>
      {warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {warning}
        </div>
      ) : null}
    </div>
  );
}
