import type { Invoice, InvoiceStatus } from "@/lib/db-types";

/** Integer cents; explicit deductions settle debt but never become received cash. */
export function reconcileInvoice(invoice: Pick<Invoice, "id" | "user_id" | "buchhaltung_id" | "currency" | "status" | "gross_total_cents" | "paid_total_cents" | "payments">) {
  const payments = invoice.payments ?? [];
  const scoped = payments.filter((p) => p.invoice_id === invoice.id && p.user_id === invoice.user_id
    && p.buchhaltung_id === invoice.buchhaltung_id && p.currency === invoice.currency);
  const receivedCents = scoped.reduce((sum, p) => sum + p.amount_cents, 0);
  const feeCents = scoped.reduce((sum, p) => sum + p.fee_cents, 0);
  const settledCents = receivedCents + feeCents;
  const legacy = scoped.some((p) => !p.request_id)
    || payments.length !== scoped.length
    || (payments.length === 0 && (invoice.paid_total_cents > 0 || ["Bezahlt", "Teilweise bezahlt"].includes(invoice.status)))
    || (payments.length > 0 && invoice.paid_total_cents !== settledCents);
  // Preserve ambiguous legacy status/balance visibly; never synthesize payment records.
  const balanceCents = invoice.gross_total_cents - (legacy ? invoice.paid_total_cents : settledCents);
  let status: InvoiceStatus = invoice.status;
  if (!legacy && !["Entwurf", "Storniert"].includes(status)) {
    status = balanceCents <= 0 ? "Bezahlt" : receivedCents > 0 ? "Teilweise bezahlt"
      : invoice.status === "Versendet" ? "Versendet" : "Ausgestellt";
  }
  return {
    receivedCents, feeCents, settledCents, balanceCents,
    remainingCents: ["Entwurf", "Storniert"].includes(status) ? 0 : Math.max(0, balanceCents),
    overpaidCents: Math.max(0, -balanceCents), status, legacy
  };
}

export function paymentStatusLabel(status: InvoiceStatus) {
  return status === "Teilweise bezahlt" ? "Teilbezahlt" : status;
}

export function receivedIncomeAmount(row: { payment_date?: string | null; payment_received_reporting?: number | null }, year?: number) {
  return row.payment_date && (year === undefined || row.payment_date.startsWith(`${year}-`))
    ? Number(row.payment_received_reporting ?? 0) : 0;
}
