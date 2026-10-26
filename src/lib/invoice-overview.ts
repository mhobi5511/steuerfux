import { reconcileInvoice } from "@/lib/invoice-accounting";
import type { Invoice } from "@/lib/db-types";

export type InvoiceOverviewGroup = "draft" | "open" | "overdue" | "paid" | "cancelled";

export type GroupedInvoices = Record<InvoiceOverviewGroup, Invoice[]>;

export function currentAccountingDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

export function classifyInvoiceForOverview(
  invoice: Invoice,
  today = currentAccountingDate()
): InvoiceOverviewGroup {
  if (invoice.status === "Storniert") return "cancelled";
  if (invoice.status === "Entwurf") return "draft";

  const state = reconcileInvoice(invoice);
  if (state.remainingCents === 0) return "paid";
  if (invoice.due_date < today) return "overdue";
  return "open";
}

export function groupInvoicesForOverview(
  invoices: Invoice[],
  today = currentAccountingDate()
): GroupedInvoices {
  const grouped: GroupedInvoices = {
    draft: [],
    open: [],
    overdue: [],
    paid: [],
    cancelled: []
  };

  for (const invoice of invoices) {
    grouped[classifyInvoiceForOverview(invoice, today)].push(invoice);
  }

  return grouped;
}
