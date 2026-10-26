import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInvoiceForOverview,
  groupInvoicesForOverview
} from "../src/lib/invoice-overview";
import type { Invoice, InvoicePayment, InvoiceStatus } from "../src/lib/db-types";

function invoice(
  id: string,
  status: InvoiceStatus,
  dueDate: string,
  paidCents = 0
): Invoice {
  const payment = paidCents > 0 ? {
    id: `payment-${id}`,
    invoice_id: id,
    income_id: null,
    user_id: "user",
    buchhaltung_id: "book",
    payment_date: "2026-10-20",
    amount_cents: paidCents,
    currency: "CHF",
    fee_cents: 0,
    note: null,
    created_at: "2026-10-20T12:00:00Z",
    request_id: `request-${id}`
  } satisfies InvoicePayment : undefined;

  return {
    id,
    user_id: "user",
    buchhaltung_id: "book",
    status,
    due_date: dueDate,
    currency: "CHF",
    gross_total_cents: 100_00,
    paid_total_cents: paidCents,
    payments: payment ? [payment] : []
  } as unknown as Invoice;
}

test("invoice overview classifies every receivable into exactly one section", () => {
  const invoices = [
    invoice("draft", "Entwurf", "2026-10-01"),
    invoice("open", "Ausgestellt", "2026-10-26"),
    invoice("partial", "Teilweise bezahlt", "2026-11-10", 40_00),
    invoice("overdue", "Versendet", "2026-10-25"),
    invoice("paid", "Bezahlt", "2026-10-01", 100_00),
    invoice("cancelled", "Storniert", "2026-10-01")
  ];

  const grouped = groupInvoicesForOverview(invoices, "2026-10-26");

  assert.deepEqual(grouped.draft.map(({ id }) => id), ["draft"]);
  assert.deepEqual(grouped.open.map(({ id }) => id), ["open", "partial"]);
  assert.deepEqual(grouped.overdue.map(({ id }) => id), ["overdue"]);
  assert.deepEqual(grouped.paid.map(({ id }) => id), ["paid"]);
  assert.deepEqual(grouped.cancelled.map(({ id }) => id), ["cancelled"]);
  assert.equal(Object.values(grouped).flat().length, invoices.length);
  assert.equal(new Set(Object.values(grouped).flat().map(({ id }) => id)).size, invoices.length);
});

test("an invoice due today remains open and a settled invoice remains paid", () => {
  assert.equal(classifyInvoiceForOverview(invoice("today", "Versendet", "2026-10-26"), "2026-10-26"), "open");
  assert.equal(classifyInvoiceForOverview(invoice("settled", "Teilweise bezahlt", "2026-10-01", 100_00), "2026-10-26"), "paid");
});
