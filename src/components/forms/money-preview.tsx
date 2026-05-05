"use client";

import { Card } from "@/components/ui/card";
import type { CurrencyCode } from "@/lib/db-types";
import { formatCurrency } from "@/lib/utils";

export function MoneyPreview({
  value,
  currency,
  title
}: {
  value: number;
  currency: CurrencyCode;
  title: string;
  description?: string;
}) {
  return (
    <Card className="bg-slate-100/80 dark:bg-slate-900">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">
        {formatCurrency(value, currency)}
      </p>
    </Card>
  );
}
