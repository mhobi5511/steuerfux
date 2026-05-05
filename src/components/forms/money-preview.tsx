"use client";

import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { CurrencyCode } from "@/lib/db-types";

export function MoneyPreview({
  value,
  currency,
  title,
  description
}: {
  value: number;
  currency: CurrencyCode;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-slate-50">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{formatCurrency(value, currency)}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </Card>
  );
}
