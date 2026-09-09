"use client";

import Link from "next/link";
import { InvoicePaymentForm } from "@/components/invoices/invoice-payment-form";
import { reconcileInvoice, paymentStatusLabel } from "@/lib/invoice-accounting";
import { useMemo, useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  cancelInvoice,
  duplicateInvoice,
  issueInvoice,
  saveInvoiceDraft,
  sendInvoiceEmail
} from "@/app/actions/invoices";
import { FormFeedback } from "@/components/forms/form-feedback";
import { InvoicePdfActions } from "@/components/invoices/invoice-pdf-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateDueDate,
  calculateInvoiceItem,
  formatCents
} from "@/lib/invoice-utils";
import {
  getVatExemptionLabel,
  getVatExemptionSentence
} from "@/lib/invoice-tax";
import type {
  BankAccount,
  Buchhaltung,
  CurrencyCode,
  Customer,
  Invoice,
  InvoiceSettings
} from "@/lib/db-types";
import { formatDate } from "@/lib/utils";

type DraftItem = {
  title: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
};

const emptyItem: DraftItem = {
  title: "",
  description: "",
  quantity: 1,
  unit: "Stk.",
  unitPrice: 0,
  vatRate: 0
};

function isOverdue(invoice: Invoice) {
  return (
    new Date(invoice.due_date) < new Date(new Date().toISOString().slice(0, 10)) &&
    reconcileInvoice(invoice).remainingCents > 0 &&
    !["Bezahlt", "Storniert", "Entwurf"].includes(invoice.status)
  );
}

function snapshotValue(snapshot: Record<string, unknown> | null | undefined, key: string) {
  return typeof snapshot?.[key] === "string" ? String(snapshot[key]) : "";
}

export function InvoiceModule({
  activeBuchhaltung,
  customers,
  invoices,
  invoiceSettings,
  bankAccounts,
  editId,
  create = false,
  filter = "Alle"
}: {
  activeBuchhaltung: Buchhaltung | null;
  customers: Customer[];
  invoices: Invoice[];
  invoiceSettings: InvoiceSettings | null;
  bankAccounts: BankAccount[];
  editId?: string;
  create?: boolean;
  filter?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ success: string | null; error: string | null }>({
    success: null,
    error: null
  });
  const editing = invoices.find((invoice) => invoice.id === editId) ?? null;
  const readOnly = activeBuchhaltung?.status === "abgeschlossen";
  const defaultCurrency = activeBuchhaltung?.reporting_currency ?? "EUR";
  const fallbackBankId = (targetCurrency: CurrencyCode) =>
    bankAccounts.find((bank) => bank.currency === targetCurrency && bank.is_default)?.id
    ?? bankAccounts[0]?.id
    ?? "";
  const [currency, setCurrency] = useState<CurrencyCode>((editing?.currency ?? defaultCurrency) as CurrencyCode);
  const [bankAccountId, setBankAccountId] = useState(editing?.bank_account_id ?? fallbackBankId((editing?.currency ?? defaultCurrency) as CurrencyCode));
  const [paymentTerm, setPaymentTerm] = useState(editing?.payment_term ?? invoiceSettings?.default_payment_term ?? "1 Monat");
  const [issueDate, setIssueDate] = useState(editing?.issue_date ?? new Date().toISOString().slice(0, 10));
  const [customDueDate, setCustomDueDate] = useState(editing?.due_date ?? "");
  const [kleinunternehmer, setKleinunternehmer] = useState(
    editing?.kleinunternehmer ?? Boolean(invoiceSettings?.default_kleinunternehmer)
  );
  const [paymentQrEnabled, setPaymentQrEnabled] = useState(
    typeof editing?.qr_payment_snapshot?.generated_enabled === "boolean"
      ? Boolean(editing.qr_payment_snapshot.generated_enabled)
      : Boolean(invoiceSettings?.default_payment_qr_enabled)
  );
  const [useUploadedQr, setUseUploadedQr] = useState(
    typeof editing?.qr_payment_snapshot?.use_uploaded_qr === "boolean"
      ? Boolean(editing.qr_payment_snapshot.use_uploaded_qr)
      : Boolean(invoiceSettings?.default_use_uploaded_qr)
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState(editing?.customer_id ?? "");
  const [items, setItems] = useState<DraftItem[]>(
    editing?.items?.length
      ? editing.items
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((item) => ({
            title: item.title,
            description: item.description ?? "",
            quantity: Number(item.quantity),
            unit: item.unit ?? "",
            unitPrice: item.unit_price_cents / 100,
            vatRate: Number(item.vat_rate)
          }))
      : [{ ...emptyItem }]
  );

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const selectedBankAccount = bankAccounts.find((bank) => bank.id === bankAccountId) ?? null;
  const customerFieldKey = selectedCustomerId || editing?.id || "new";
  const vatExemptionLabel = getVatExemptionLabel(activeBuchhaltung?.country ?? "Deutschland");
  const vatExemptionSentence = getVatExemptionSentence(activeBuchhaltung?.country ?? "Deutschland");
  const dueDate = calculateDueDate(issueDate, paymentTerm, customDueDate);
  const totals = useMemo(() => {
    return items.reduce(
      (sum, item) => {
        const calculated = calculateInvoiceItem({
          ...item,
          currency,
          vatRate: kleinunternehmer ? 0 : item.vatRate
        });
        return {
          net: sum.net + calculated.netAmountCents,
          vat: sum.vat + calculated.vatAmountCents,
          gross: sum.gross + calculated.grossAmountCents
        };
      },
      { net: 0, vat: 0, gross: 0 }
    );
  }, [currency, items, kleinunternehmer]);
  const hasPaymentBank = Boolean(selectedBankAccount?.account_holder && selectedBankAccount.iban);
  const usesUploadedPaymentQr = Boolean(useUploadedQr && selectedBankAccount?.qr_storage_path);
  const isSwissBook = activeBuchhaltung?.country === "Schweiz";
  const hasSwissCreditorAddress = Boolean(
    (selectedBankAccount?.swiss_qr_street || invoiceSettings?.sender_street)
      && (selectedBankAccount?.swiss_qr_postal_code || invoiceSettings?.sender_postal_code)
      && (selectedBankAccount?.swiss_qr_city || invoiceSettings?.sender_city)
      && (selectedBankAccount?.swiss_qr_country || invoiceSettings?.sender_country)
  );
  const swissQrWarning = !isSwissBook
    ? null
    : !hasPaymentBank
      ? "Swiss QR kann nicht erstellt werden, weil die IBAN fehlt."
      : selectedBankAccount?.qr_iban
        ? "Für die QR-IBAN fehlt noch eine gültige QR-Referenz. Bis dahin wird bei Bedarf der Fallback-QR verwendet."
        : !hasSwissCreditorAddress
          ? "Swiss QR kann nicht erstellt werden, weil die Unternehmensadresse unvollständig ist."
          : null;
  const usesAutomaticPaymentQr = Boolean(
    isSwissBook
      ? hasPaymentBank && hasSwissCreditorAddress && !selectedBankAccount?.qr_iban
      : paymentQrEnabled && currency === "EUR" && hasPaymentBank
  );

  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const searchedInvoices = invoices.filter((invoice) => `${invoice.invoice_number ?? ""} ${snapshotValue(invoice.customer_snapshot, "company_name")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const cancelledInvoices = searchedInvoices.filter((invoice) => invoice.status === "Storniert");
  const visibleInvoices = searchedInvoices.filter((invoice) => {
    if (invoice.status === "Storniert") return false;
    if (filter === "Alle") return true;
    if (filter === "Offen") return ["Ausgestellt", "Versendet", "Teilweise bezahlt"].includes(invoice.status);
    if (filter === "Überfällig") return isOverdue(invoice);
    return invoice.status === filter;
  });
  const customerLastUsed = new Map<string, string>();
  invoices.forEach((invoice) => {
    if (invoice.customer_id) customerLastUsed.set(invoice.customer_id, [customerLastUsed.get(invoice.customer_id) ?? "", invoice.issue_date].sort().at(-1) ?? "");
  });
  const matchingCustomers = customers
    .filter((customer) => `${customer.company_name} ${customer.email} ${customer.city}`.toLocaleLowerCase().includes(customerSearch.toLocaleLowerCase()))
    .sort((a, b) => {
      const recent = (customerLastUsed.get(b.id) ?? "").localeCompare(customerLastUsed.get(a.id) ?? "");
      return recent || a.company_name.localeCompare(b.company_name, "de");
    });

  function InvoiceActions({ invoice }: { invoice: Invoice }) {
    const state = reconcileInvoice(invoice);
    const canPay = !readOnly && !["Entwurf", "Storniert"].includes(invoice.status);
    const canCancel = !readOnly && ["Entwurf", "Ausgestellt", "Versendet", "Teilweise bezahlt"].includes(invoice.status);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {invoice.status === "Entwurf" && !readOnly ? (
          <Link href={`/rechnungen?edit=${invoice.id}`}><Button type="button" variant="secondary">Bearbeiten</Button></Link>
        ) : (
          <InvoicePdfActions invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} recipientName={snapshotValue(invoice.customer_snapshot, "company_name")} showDownload={false} previewLabel="Ansehen" />
        )}
        {canPay ? <InvoicePaymentForm invoice={invoice} reportingCurrency={defaultCurrency} /> : null}
        <details className="relative">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl px-3 text-slate-700 hover:bg-slate-100 md:min-h-10" aria-label="Weitere Aktionen">
            <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 grid min-w-[16rem] gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-panel dark:bg-slate-900">
            {invoice.status !== "Entwurf" ? <InvoicePdfActions invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} recipientName={snapshotValue(invoice.customer_snapshot, "company_name")} /> : null}
            {invoice.status === "Entwurf" && !readOnly ? <form action={submitAction(issueInvoice)}><input name="id" type="hidden" value={invoice.id} /><Button type="submit" className="w-full justify-start" variant="ghost">Ausstellen</Button></form> : null}
            {!readOnly ? <form action={submitAction(duplicateInvoice)}><input name="id" type="hidden" value={invoice.id} /><Button type="submit" className="w-full justify-start" variant="ghost">Duplizieren</Button></form> : null}
            {!readOnly && invoice.invoice_number && ["Ausgestellt", "Versendet"].includes(invoice.status) ? <details className="rounded-lg p-1"><summary className="cursor-pointer px-3 py-2 text-sm text-slate-700">{invoice.status === "Versendet" ? "Erneut senden" : "Versenden"}</summary><form action={submitAction(sendInvoiceEmail)} className="mt-2 grid gap-2 border-t border-slate-200 pt-2"><input name="invoice_id" type="hidden" value={invoice.id} /><Input name="to" type="email" defaultValue={snapshotValue(invoice.customer_snapshot, "email")} aria-label="E-Mail-Adresse" /><Input name="subject" defaultValue={`Rechnung ${invoice.invoice_number}`} aria-label="Betreff" /><Textarea name="message" defaultValue={`Guten Tag,\n\nanbei erhalten Sie die Rechnung ${invoice.invoice_number}.\n\nFreundliche Grüße`} aria-label="Nachricht" /><Button type="submit">E-Mail senden</Button></form></details> : null}
            {(invoice.payments?.length ?? 0) > 0 ? <details className="rounded-lg p-1"><summary className="cursor-pointer px-3 py-2 text-sm text-slate-700">Zahlungen ansehen</summary><div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm text-slate-700">{[...(invoice.payments ?? [])].sort((a, b) => a.payment_date.localeCompare(b.payment_date)).map((payment) => <p key={payment.id}>{formatDate(payment.payment_date)} · {formatCents(payment.amount_cents, payment.currency)}</p>)}<p className="font-medium">Offen: {formatCents(state.remainingCents, invoice.currency)}</p></div></details> : null}
            {canCancel ? <form action={submitAction(cancelInvoice)} onSubmit={(event) => { if (!window.confirm((invoice.payments?.length || invoice.paid_total_cents > 0) ? "Es bestehen Zahlungen. Die Stornierung ist bis zur buchhalterischen Klärung gesperrt. Es werden keine Einnahmen rückgebucht. Prüfung fortsetzen?" : "Rechnung wirklich stornieren? Die historische Rechnung bleibt erhalten.")) event.preventDefault(); }} className="border-t border-slate-200 pt-1"><input name="buchhaltung_id" type="hidden" value={invoice.buchhaltung_id} /><input name="confirm" type="hidden" value="true" /><input name="id" type="hidden" value={invoice.id} /><Button type="submit" disabled={pending} className="w-full justify-start" variant="ghost">Stornieren</Button></form> : null}
          </div>
        </details>
      </div>
    );
  }

  function submitAction(action: (formData: FormData) => Promise<{ success?: string; error?: string; customerId?: string }>) {
    return (formData: FormData) =>
      startTransition(async () => {
        setMessage({ success: null, error: null });
        const result = await action(formData);
        if (result.customerId) {
          setSelectedCustomerId(result.customerId);
          setMessage({ success: "Vorhandenen Empfänger verwenden und Entwurf erneut speichern.", error: null });
          return;
        }
        setMessage({ success: result.success ?? null, error: result.error ?? null });
      });
  }

  return (
    <div className="space-y-6">
      <FormFeedback success={message.success} error={message.error} />

      {!readOnly && (editing || create) ? (
        <div className="grid gap-6 xl:grid-cols-[1.45fr_0.9fr]">
          <Card className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                {editing ? "Rechnung bearbeiten" : "Neue Rechnung"}
              </h2>
              <p className="hidden text-sm text-slate-600 sm:block">
                Empfänger, Daten, Positionen und Bankverbindung werden beim Ausstellen als Snapshot gespeichert.
              </p>
            </div>

            <form action={submitAction(saveInvoiceDraft)} className="grid gap-5">
              {editing ? <input name="id" type="hidden" value={editing.id} /> : null}
              <input
                name="items_json"
                type="hidden"
                value={JSON.stringify(
                  items.map((item) => ({
                    ...item,
                    vatRate: kleinunternehmer ? 0 : item.vatRate
                  }))
                )}
              />
              <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 lg:grid-cols-2">
                <div className="lg:col-span-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Schritt 1</p><h3 className="text-base font-semibold text-slate-950">Empfänger</h3></div>
                <Field label="Empfänger suchen">
                  <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} type="search" placeholder="Name, E-Mail oder Ort" />
                </Field>
                <Field label="Bestehenden Empfänger verwenden">
                  <Select name="customer_id" value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
                    <option value="">Neuen Empfänger erfassen</option>
                    {matchingCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name} · {customer.email}</option>)}
                  </Select>
                </Field>
                <label className="lg:col-span-2 flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-4 text-sm text-slate-700"><input name="save_customer" type="checkbox" value="true" defaultChecked={!selectedCustomerId} className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /> Empfänger für spätere Rechnungen speichern</label>
              <Field label="Firma / Name">
                <Input
                  key={`${customerFieldKey}-company`}
                  name="customer_company_name"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "company_name") || selectedCustomer?.company_name || ""}
                />
              </Field>
              <Field label="Kontakt optional">
                <Input
                  key={`${customerFieldKey}-contact`}
                  name="customer_contact_name"
                  defaultValue={snapshotValue(editing?.customer_snapshot, "contact_name") || selectedCustomer?.contact_name || ""}
                />
              </Field>
              <Field label="Strasse">
                  <Input
                    key={`${customerFieldKey}-street`}
                    name="customer_street"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "street") || selectedCustomer?.street || ""}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[0.7fr_1.3fr]">
                <Field label="PLZ">
                  <Input
                    key={`${customerFieldKey}-postal`}
                    name="customer_postal_code"
                    required
                    defaultValue={snapshotValue(editing?.customer_snapshot, "postal_code") || selectedCustomer?.postal_code || ""}
                  />
                </Field>
                <Field label="Ort">
                  <Input
                    key={`${customerFieldKey}-city`}
                    name="customer_city"
                    required
                    defaultValue={snapshotValue(editing?.customer_snapshot, "city") || selectedCustomer?.city || ""}
                  />
                </Field>
              </div>
              <Field label="Land">
                <Input
                  key={`${customerFieldKey}-country`}
                  name="customer_country"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "country") || selectedCustomer?.country || activeBuchhaltung?.country || ""}
                />
              </Field>
              <Field label="E-Mail">
                <Input
                  key={`${customerFieldKey}-email`}
                  name="customer_email"
                  type="email"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "email") || selectedCustomer?.email || ""}
                />
              </Field>
              </section>

              <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 lg:grid-cols-2">
                <div className="lg:col-span-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Schritt 2</p><h3 className="text-base font-semibold text-slate-950">Rechnungsdetails</h3></div>
              <Field label="Ausstellungsdatum">
                <Input
                  name="issue_date"
                  type="date"
                  required
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                />
              </Field>
              <Field label="Zahlungsziel">
                <Select
                  name="payment_term"
                  value={paymentTerm}
                  onChange={(event) => setPaymentTerm(event.target.value)}
                >
                  {["sofort", "7 Tage", "14 Tage", "30 Tage", "1 Monat", "benutzerdefiniert"].map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </Select>
              </Field>
              {paymentTerm === "benutzerdefiniert" ? (
                <Field label="Fälligkeitsdatum">
                  <Input
                    name="custom_due_date"
                    type="date"
                    value={customDueDate}
                    onChange={(event) => setCustomDueDate(event.target.value)}
                  />
                </Field>
              ) : (
                <input name="custom_due_date" type="hidden" value={dueDate} />
              )}
              <Field label="Rechnungswährung">
                <Select
                  name="currency"
                  value={currency}
                  onChange={(event) => {
                    const nextCurrency = event.target.value as CurrencyCode;
                    setCurrency(nextCurrency);
                    setBankAccountId(fallbackBankId(nextCurrency));
                  }}
                >
                  <option value="EUR">EUR</option>
                  <option value="CHF">CHF</option>
                </Select>
              </Field>
              <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-4 text-sm text-slate-700"><input name="kleinunternehmer" type="checkbox" value="true" checked={kleinunternehmer} onChange={(event) => setKleinunternehmer(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /> {vatExemptionLabel}</label>
              </section>
              <section className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Schritt 3</p><h3 className="text-base font-semibold text-slate-950">Positionen</h3></div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-950">Positionen</h3>
                  <Button type="button" variant="secondary" onClick={() => setItems((value) => [...value, { ...emptyItem }])}>
                    Position hinzufügen
                  </Button>
                </div>
                <div className="grid gap-3">
                  {items.map((item, index) => (
                    <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-6">
                      <Field label="Leistung" hint="Produkt oder Dienstleistung"><Input
                        placeholder="Produkt oder Dienstleistung"
                        value={item.title}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))
                        }
                        className="lg:col-span-2" /></Field>
                      <Field label="Menge"><Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={item.quantity}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))
                        }
                      /></Field>
                      <Field label="Einheit"><Input
                        placeholder="Einheit"
                        value={item.unit}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value } : row))
                        }
                      /></Field>
                      <Field label="Preis pro Einheit"><Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unitPrice}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) } : row))
                        }
                      /></Field>
                      <Field label="MwSt. %"><Input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={kleinunternehmer}
                        value={kleinunternehmer ? 0 : item.vatRate}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, vatRate: Number(event.target.value) } : row))
                        }
                      /></Field>
                      <div className="lg:col-span-5"><Field label="Beschreibung (optional)"><Textarea
                        placeholder="Beschreibung optional"
                        value={item.description}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))
                        }
                      /></Field></div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setItems((value) => value.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        Entfernen
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              </section>
              <details className="rounded-2xl border border-slate-200 p-4">
                <summary className="cursor-pointer font-medium text-slate-900">Erweiterte Einstellungen</summary>
                <div className="mt-4 grid gap-4 lg:grid-cols-2"><Field label="Bankverbindung"><Select name="bank_account_id" value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}><option value="">Keine Bankverbindung</option>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.label} · {bank.currency}</option>)}</Select></Field>
                {!isSwissBook && currency === "EUR" ? <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-4 text-sm text-slate-700"><input name="payment_qr_enabled" type="checkbox" value="true" checked={paymentQrEnabled} onChange={(event) => setPaymentQrEnabled(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /> EPC-QR-Code anzeigen</label> : null}
                {!isSwissBook && currency === "EUR" ? <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-4 text-sm text-slate-700"><input name="use_uploaded_qr" type="checkbox" value="true" checked={useUploadedQr} onChange={(event) => setUseUploadedQr(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /> Hochgeladenen QR-Code verwenden</label> : null}</div>
              </details>
              <Field label="Notiz (optional)">
                <Textarea name="notes" defaultValue={editing?.notes ?? ""} />
              </Field>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="submit" disabled={pending}>
                  Entwurf speichern
                </Button>
              </div>
            </form>
          </Card>

          <Card className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Schritt 4</p><h2 className="text-lg font-semibold text-slate-950">Vorschau & Ausstellen</h2></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Fällig bis</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{formatDate(dueDate)}</p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {formatCents(totals.gross, currency)}
              </p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <div className="flex justify-between"><span>Netto</span><span>{formatCents(totals.net, currency)}</span></div>
                <div className="flex justify-between"><span>MwSt.</span><span>{formatCents(totals.vat, currency)}</span></div>
                <div className="flex justify-between font-semibold text-slate-950"><span>Brutto</span><span>{formatCents(totals.gross, currency)}</span></div>
              </div>
              {kleinunternehmer ? (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  {vatExemptionSentence}
                </p>
              ) : null}
              <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-950">Zahlung an:</p>
                {hasPaymentBank ? (
                  <p className="mt-1">{selectedBankAccount?.account_holder}<br />IBAN: {selectedBankAccount?.iban}<br />{selectedBankAccount?.currency} · QR: {usesUploadedPaymentQr || usesAutomaticPaymentQr ? "aktiv" : "nicht aktiv"}</p>
                ) : (
                  <p className="mt-1 font-medium text-rose-700">Keine Bankverbindung hinterlegt.</p>
                )}
                {isSwissBook ? <p className={swissQrWarning ? "mt-3 rounded-xl bg-amber-50 p-3 text-amber-800" : "mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-700"}>{swissQrWarning ?? "✓ Automatischer Swiss QR wird beim Erstellen des PDFs erzeugt."}</p> : null}
              </div>
            </div>
            {editing?.status === "Entwurf" ? (
              <form action={submitAction(issueInvoice)}>
                <input name="id" type="hidden" value={editing.id} />
                <Button type="submit" disabled={pending || !hasPaymentBank} className="w-full">
                  Rechnung ausstellen
                </Button>
              </form>
            ) : null}
          </Card>
        </div>
      ) : readOnly ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            Diese Buchhaltung ist abgeschlossen und schreibgeschützt.
          </p>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">Rechnungsübersicht</h2>
          {!readOnly ? <Link href="/rechnungen?neu=1"><Button type="button">Neue Rechnung</Button></Link> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {["Alle", "Entwurf", "Offen", "Überfällig", "Bezahlt"].map((item) => (
            <Link
              key={item}
              href={`/rechnungen?filter=${encodeURIComponent(item)}`}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {item}
            </Link>
          ))}
        </div>
        <Field label="Rechnung oder Empfänger suchen"><Input value={search} onChange={(e) => setSearch(e.target.value)} type="search" /></Field>
        <div className="grid gap-3 md:hidden">
          {visibleInvoices.map((invoice) => {
            const state = reconcileInvoice(invoice);
            return <article key={invoice.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-950">{invoice.invoice_number ?? "Entwurf"}</p><p className="mt-1 truncate text-sm text-slate-600">{snapshotValue(invoice.customer_snapshot, "company_name")}</p></div><span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{paymentStatusLabel(state.status)}</span></div>
              <p className="mt-4 text-xl font-semibold text-slate-950">{formatCents(invoice.gross_total_cents, invoice.currency)}</p>
              {(state.receivedCents > 0 || state.remainingCents > 0) ? <div className="mt-2 grid grid-cols-2 gap-2 text-sm"><p className="rounded-lg bg-slate-50 p-2 text-slate-600">Bezahlt<br /><span className="font-medium text-slate-950">{formatCents(state.receivedCents, invoice.currency)}</span></p><p className="rounded-lg bg-slate-50 p-2 text-slate-600">Offen<br /><span className="font-medium text-slate-950">{formatCents(state.remainingCents, invoice.currency)}</span></p></div> : null}
              <p className={isOverdue(invoice) ? "mt-3 text-sm font-medium text-rose-700" : "mt-3 text-sm text-slate-500"}>Fällig: {formatDate(invoice.due_date)}{isOverdue(invoice) ? " · Überfällig" : ""}</p>
              <div className="mt-4"><InvoiceActions invoice={invoice} /></div>
            </article>;
          })}
          {visibleInvoices.length === 0 ? <p className="py-8 text-sm text-slate-500">Noch keine Rechnungen vorhanden.</p> : null}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-3">Rechnungsnummer</th>
                <th className="px-3 py-3">Empfänger</th>
                <th className="px-3 py-3">Ausgestellt</th>
                <th className="px-3 py-3">Fälligkeit</th>
                <th className="px-3 py-3">Betrag</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-line">
                  <td className="px-3 py-3">{invoice.invoice_number ?? "Entwurf"}</td>
                  <td className="px-3 py-3">{snapshotValue(invoice.customer_snapshot, "company_name")}</td>
                  <td className="px-3 py-3">{formatDate(invoice.issue_date)}</td>
                  <td className="px-3 py-3">
                    <span className={isOverdue(invoice) ? "font-semibold text-rose-700" : ""}>
                      {formatDate(invoice.due_date)}
                    </span>
                  </td>
                  <td className="px-3 py-3">{formatCents(invoice.gross_total_cents, invoice.currency)}
                    <p className="mt-1 text-xs">Bezahlt: {formatCents(reconcileInvoice(invoice).receivedCents, invoice.currency)}</p>
                    <p className="text-xs">Offen: {formatCents(reconcileInvoice(invoice).remainingCents, invoice.currency)}</p>
                    {reconcileInvoice(invoice).feeCents > 0 ? <p className="text-xs">Ausgleich: {formatCents(reconcileInvoice(invoice).feeCents, invoice.currency)}</p> : null}
                    {reconcileInvoice(invoice).overpaidCents > 0 ? <p className="text-xs text-amber-700">Überzahlung: {formatCents(reconcileInvoice(invoice).overpaidCents, invoice.currency)}</p> : null}
                    {reconcileInvoice(invoice).legacy ? <p className="text-xs text-amber-700">Altbestand: Abstimmung erforderlich</p> : null}
                  </td>
                  <td className="px-3 py-3">{paymentStatusLabel(reconcileInvoice(invoice).status)}{isOverdue(invoice) ? " · Überfällig" : ""}</td>
                  <td className="px-3 py-3">
                    <InvoiceActions invoice={invoice} />
                  </td>
                </tr>
              ))}
              {visibleInvoices.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-slate-500">Noch keine Rechnungen vorhanden.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <details open={filter === "Storniert" ? true : undefined}>
          <summary className="cursor-pointer font-semibold">Stornierte Rechnungen ({cancelledInvoices.length})</summary>
          <div className="mt-4 space-y-4">{cancelledInvoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
            <p>{invoice.invoice_number ?? "Entwurf"} · {snapshotValue(invoice.customer_snapshot, "company_name")} · {formatDate(invoice.issue_date)} · {formatCents(invoice.gross_total_cents, invoice.currency)} · Storniert</p>
            <InvoicePdfActions invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} recipientName={snapshotValue(invoice.customer_snapshot, "company_name")} />
            {(invoice.payments ?? []).map((payment) => <p key={payment.id}>{formatDate(payment.payment_date)} · Zahlung {formatCents(payment.amount_cents, payment.currency)} · {payment.note}</p>)}
          </div>)}</div>
        </details>
      </Card>
    </div>
  );
}
