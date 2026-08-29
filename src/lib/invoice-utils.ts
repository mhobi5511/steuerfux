import type { CurrencyCode } from "@/lib/db-types";

export type InvoiceItemInput = {
  title: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  currency: CurrencyCode;
  vatRate: number;
};

export function toCents(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

export function fromCents(value: number) {
  return (value || 0) / 100;
}

export function formatCents(value: number, currency: CurrencyCode) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(fromCents(value));
}

export function calculateInvoiceItem(item: InvoiceItemInput) {
  const quantityUnits = Math.round(item.quantity * 10000);
  const unitPriceCents = toCents(item.unitPrice);
  const netAmountCents = Math.round((quantityUnits * unitPriceCents) / 10000);
  const vatAmountCents = Math.round(netAmountCents * ((item.vatRate || 0) / 100));
  return {
    unitPriceCents,
    netAmountCents,
    vatAmountCents,
    grossAmountCents: netAmountCents + vatAmountCents
  };
}

export function calculateDueDate(issueDate: string, paymentTerm: string, customDueDate?: string) {
  if (paymentTerm === "benutzerdefiniert" && customDueDate) return customDueDate;

  // Invoice dates are calendar dates, not instants. UTC arithmetic prevents a
  // server timezone from moving the result to the previous/next day.
  const date = issueDate ? new Date(`${issueDate}T00:00:00Z`) : new Date();
  if (paymentTerm === "sofort") return date.toISOString().slice(0, 10);
  if (paymentTerm === "7 Tage") date.setUTCDate(date.getUTCDate() + 7);
  else if (paymentTerm === "14 Tage") date.setUTCDate(date.getUTCDate() + 14);
  else if (paymentTerm === "30 Tage") date.setUTCDate(date.getUTCDate() + 30);
  else {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDayOfTargetMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  }
  return date.toISOString().slice(0, 10);
}

export function isInvoiceOpen(status: string) {
  return ["Ausgestellt", "Versendet", "Teilweise bezahlt"].includes(status);
}
