"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  cancelInvoice,
  duplicateInvoice,
  issueInvoice,
  recordInvoicePayment,
  saveBankAccount,
  saveInvoiceDraft,
  saveInvoiceSettings,
  sendInvoiceEmail
} from "@/app/actions/invoices";
import { FormFeedback } from "@/components/forms/form-feedback";
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
  getVatExemptionSentence,
  getVatExemptionSettingsLabel
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
    invoice.gross_total_cents > invoice.paid_total_cents &&
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
  filter = "Alle"
}: {
  activeBuchhaltung: Buchhaltung | null;
  customers: Customer[];
  invoices: Invoice[];
  invoiceSettings: InvoiceSettings | null;
  bankAccounts: BankAccount[];
  editId?: string;
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
  const [currency, setCurrency] = useState<CurrencyCode>((editing?.currency ?? defaultCurrency) as CurrencyCode);
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
  const vatExemptionLabel = getVatExemptionLabel(activeBuchhaltung?.country ?? "Deutschland");
  const vatExemptionSettingsLabel = getVatExemptionSettingsLabel(activeBuchhaltung?.country ?? "Deutschland");
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

  const visibleInvoices = invoices.filter((invoice) => {
    if (filter === "Alle") return true;
    if (filter === "Offen") return ["Ausgestellt", "Versendet", "Teilweise bezahlt"].includes(invoice.status);
    if (filter === "Überfällig") return isOverdue(invoice);
    return invoice.status === filter;
  });

  function submitAction(action: (formData: FormData) => Promise<{ success?: string; error?: string }>) {
    return (formData: FormData) =>
      startTransition(async () => {
        setMessage({ success: null, error: null });
        const result = await action(formData);
        setMessage({ success: result.success ?? null, error: result.error ?? null });
      });
  }

  return (
    <div className="space-y-6">
      <FormFeedback success={message.success} error={message.error} />

      {!readOnly ? (
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

            <form action={submitAction(saveInvoiceDraft)} className="grid gap-4 lg:grid-cols-2">
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
              <Field label="Bestehender Empfänger">
                <Select
                  name="customer_id"
                  value={selectedCustomerId}
                  onChange={(event) => setSelectedCustomerId(event.target.value)}
                >
                  <option value="">Neuen Empfänger erfassen</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.company_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Empfänger speichern">
                <Select name="save_customer" defaultValue={selectedCustomerId ? "false" : "true"}>
                  <option value="true">Ja</option>
                  <option value="false">Nein</option>
                </Select>
              </Field>
              <Field label="Firma / Name">
                <Input
                  name="customer_company_name"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "company_name") || selectedCustomer?.company_name || ""}
                />
              </Field>
              <Field label="Kontakt optional">
                <Input
                  name="customer_contact_name"
                  defaultValue={snapshotValue(editing?.customer_snapshot, "contact_name") || selectedCustomer?.contact_name || ""}
                />
              </Field>
              <Field label="Strasse">
                <Input
                  name="customer_street"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "street") || selectedCustomer?.street || ""}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[0.7fr_1.3fr]">
                <Field label="PLZ">
                  <Input
                    name="customer_postal_code"
                    required
                    defaultValue={snapshotValue(editing?.customer_snapshot, "postal_code") || selectedCustomer?.postal_code || ""}
                  />
                </Field>
                <Field label="Ort">
                  <Input
                    name="customer_city"
                    required
                    defaultValue={snapshotValue(editing?.customer_snapshot, "city") || selectedCustomer?.city || ""}
                  />
                </Field>
              </div>
              <Field label="Land">
                <Input
                  name="customer_country"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "country") || selectedCustomer?.country || activeBuchhaltung?.country || ""}
                />
              </Field>
              <Field label="E-Mail">
                <Input
                  name="customer_email"
                  type="email"
                  required
                  defaultValue={snapshotValue(editing?.customer_snapshot, "email") || selectedCustomer?.email || ""}
                />
              </Field>

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
                  onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
                >
                  <option value="EUR">EUR</option>
                  <option value="CHF">CHF</option>
                </Select>
              </Field>
              <Field label={vatExemptionLabel}>
                <Select
                  name="kleinunternehmer"
                  value={kleinunternehmer ? "true" : "false"}
                  onChange={(event) => setKleinunternehmer(event.target.value === "true")}
                >
                  <option value="false">Nein</option>
                  <option value="true">Ja</option>
                </Select>
              </Field>
              <Field label="Bankverbindung">
                <Select name="bank_account_id" defaultValue={editing?.bank_account_id ?? bankAccounts.find((bank) => bank.currency === currency && bank.is_default)?.id ?? ""}>
                  <option value="">Keine Bankverbindung</option>
                  {bankAccounts.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.label} · {bank.currency}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Automatischen Zahlungs-QR-Code anzeigen">
                <Select
                  name="payment_qr_enabled"
                  value={paymentQrEnabled ? "true" : "false"}
                  onChange={(event) => setPaymentQrEnabled(event.target.value === "true")}
                >
                  <option value="true">Ja</option>
                  <option value="false">Nein</option>
                </Select>
              </Field>
              <Field label="Hochgeladenen QR-Code verwenden">
                <Select
                  name="use_uploaded_qr"
                  value={useUploadedQr ? "true" : "false"}
                  onChange={(event) => setUseUploadedQr(event.target.value === "true")}
                >
                  <option value="false">Nein</option>
                  <option value="true">Ja</option>
                </Select>
              </Field>

              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-950">Positionen</h3>
                  <Button type="button" variant="secondary" onClick={() => setItems((value) => [...value, { ...emptyItem }])}>
                    Position hinzufügen
                  </Button>
                </div>
                <div className="grid gap-3">
                  {items.map((item, index) => (
                    <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-6">
                      <Input
                        placeholder="Produkt oder Dienstleistung"
                        value={item.title}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))
                        }
                        className="lg:col-span-2"
                      />
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={item.quantity}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))
                        }
                      />
                      <Input
                        placeholder="Einheit"
                        value={item.unit}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value } : row))
                        }
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unitPrice}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) } : row))
                        }
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={kleinunternehmer}
                        value={kleinunternehmer ? 0 : item.vatRate}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, vatRate: Number(event.target.value) } : row))
                        }
                      />
                      <Textarea
                        placeholder="Beschreibung optional"
                        value={item.description}
                        onChange={(event) =>
                          setItems((value) => value.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))
                        }
                        className="lg:col-span-5"
                      />
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

              <Field label="Notiz optional">
                <Textarea name="notes" defaultValue={editing?.notes ?? ""} />
              </Field>

              <div className="lg:col-span-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="submit" disabled={pending}>
                  Entwurf speichern
                </Button>
              </div>
            </form>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">Vorschau</h2>
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
            </div>
            {editing?.status === "Entwurf" ? (
              <form action={submitAction(issueInvoice)}>
                <input name="id" type="hidden" value={editing.id} />
                <Button type="submit" disabled={pending} className="w-full">
                  Rechnung ausstellen
                </Button>
              </form>
            ) : null}
          </Card>
        </div>
      ) : (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">
            Diese Buchhaltung ist abgeschlossen und schreibgeschützt.
          </p>
        </Card>
      )}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-950">Rechnungsübersicht</h2>
        <div className="flex flex-wrap gap-2">
          {["Alle", "Entwurf", "Offen", "Überfällig", "Bezahlt", "Storniert"].map((item) => (
            <Link
              key={item}
              href={`/rechnungen?filter=${encodeURIComponent(item)}`}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {item}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto">
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
                  <td className="px-3 py-3">{formatCents(invoice.gross_total_cents, invoice.currency)}</td>
                  <td className="px-3 py-3">{isOverdue(invoice) ? "Überfällig" : invoice.status}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/api/invoices/${invoice.id}/pdf`} target="_blank">
                        <Button type="button" variant="ghost">PDF ansehen</Button>
                      </Link>
                      {invoice.status === "Entwurf" && !readOnly ? (
                        <Link href={`/rechnungen?edit=${invoice.id}`}>
                          <Button type="button" variant="ghost">Bearbeiten</Button>
                        </Link>
                      ) : null}
                      {!readOnly ? (
                        <form action={submitAction(duplicateInvoice)}>
                          <input name="id" type="hidden" value={invoice.id} />
                          <Button type="submit" variant="ghost">Duplizieren</Button>
                        </form>
                      ) : null}
                      {!readOnly && !["Entwurf", "Bezahlt", "Storniert"].includes(invoice.status) ? (
                        <details className="min-w-[240px]">
                          <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Zahlung erfassen</summary>
                          <form action={submitAction(recordInvoicePayment)} className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
                            <input name="invoice_id" type="hidden" value={invoice.id} />
                            <Input name="payment_date" type="date" required />
                            <Input name="amount" type="number" step="0.01" defaultValue={(invoice.gross_total_cents - invoice.paid_total_cents) / 100} />
                            <Select name="currency" defaultValue={invoice.currency}><option value="EUR">EUR</option><option value="CHF">CHF</option></Select>
                            <Input name="exchange_rate" type="number" step="0.0001" defaultValue="1" />
                            <Input name="fee" type="number" step="0.01" placeholder="Gebühr optional" />
                            <Button type="submit">Speichern</Button>
                          </form>
                        </details>
                      ) : null}
                      {!readOnly && invoice.status !== "Storniert" ? (
                        <form action={submitAction(cancelInvoice)}>
                          <input name="id" type="hidden" value={invoice.id} />
                          <Button type="submit" variant="danger">Stornieren</Button>
                        </form>
                      ) : null}
                      {!readOnly && invoice.invoice_number ? (
                        <details className="min-w-[260px]">
                          <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">Versenden</summary>
                          <form action={submitAction(sendInvoiceEmail)} className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
                            <input name="invoice_id" type="hidden" value={invoice.id} />
                            <Input name="to" type="email" defaultValue={snapshotValue(invoice.customer_snapshot, "email")} />
                            <Input name="subject" defaultValue={`Rechnung ${invoice.invoice_number}`} />
                            <Textarea name="message" defaultValue={`Guten Tag,\n\nanbei erhalten Sie die Rechnung ${invoice.invoice_number}.\n\nFreundliche Grüße`} />
                            <Button type="submit">E-Mail senden</Button>
                          </form>
                        </details>
                      ) : null}
                    </div>
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

      {!readOnly ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">Rechnungseinstellungen</h2>
            <form action={submitAction(saveInvoiceSettings)} className="grid gap-4 lg:grid-cols-2">
              <Field label="Name / Firmenname"><Input name="sender_name" defaultValue={invoiceSettings?.sender_name ?? ""} /></Field>
              <Field label="Zusatz optional"><Input name="sender_addition" defaultValue={invoiceSettings?.sender_addition ?? ""} /></Field>
              <Field label="Strasse"><Input name="sender_street" defaultValue={invoiceSettings?.sender_street ?? ""} /></Field>
              <Field label="PLZ"><Input name="sender_postal_code" defaultValue={invoiceSettings?.sender_postal_code ?? ""} /></Field>
              <Field label="Ort"><Input name="sender_city" defaultValue={invoiceSettings?.sender_city ?? ""} /></Field>
              <Field label="Land"><Input name="sender_country" defaultValue={invoiceSettings?.sender_country ?? activeBuchhaltung?.country ?? ""} /></Field>
              <Field label="E-Mail"><Input name="sender_email" type="email" defaultValue={invoiceSettings?.sender_email ?? ""} /></Field>
              <Field label="Telefon optional"><Input name="sender_phone" defaultValue={invoiceSettings?.sender_phone ?? ""} /></Field>
              <Field label="Steuernummer / UID optional"><Input name="sender_tax_id" defaultValue={invoiceSettings?.sender_tax_id ?? ""} /></Field>
              <Field label="Prefix"><Input name="invoice_prefix" defaultValue={invoiceSettings?.invoice_prefix ?? "RG"} /></Field>
              <Field label="Nächste Nummer"><Input name="next_invoice_number" type="number" defaultValue={invoiceSettings?.next_invoice_number ?? 1} /></Field>
              <Field label="Jährlicher Reset"><Select name="yearly_reset" defaultValue={invoiceSettings?.yearly_reset === false ? "false" : "true"}><option value="true">Ja</option><option value="false">Nein</option></Select></Field>
              <Field label="Standard-Zahlungsziel"><Select name="default_payment_term" defaultValue={invoiceSettings?.default_payment_term ?? "1 Monat"}>{["sofort", "7 Tage", "14 Tage", "30 Tage", "1 Monat"].map((term) => <option key={term} value={term}>{term}</option>)}</Select></Field>
              <Field label={vatExemptionSettingsLabel}><Select name="default_kleinunternehmer" defaultValue={invoiceSettings?.default_kleinunternehmer ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
              <Field label="Automatischen Zahlungs-QR-Code anzeigen"><Select name="default_payment_qr_enabled" defaultValue={invoiceSettings?.default_payment_qr_enabled ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
              <Field label="Hochgeladenen QR-Code verwenden"><Select name="default_use_uploaded_qr" defaultValue={invoiceSettings?.default_use_uploaded_qr ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
              <div className="lg:col-span-2 flex justify-end"><Button type="submit">Einstellungen speichern</Button></div>
            </form>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">Bankverbindung</h2>
            <form action={submitAction(saveBankAccount)} className="grid gap-4 lg:grid-cols-2" encType="multipart/form-data">
              <Field label="Bezeichnung"><Input name="label" placeholder="EUR Konto" /></Field>
              <Field label="Währung"><Select name="currency" defaultValue={defaultCurrency}><option value="EUR">EUR</option><option value="CHF">CHF</option></Select></Field>
              <Field label="Kontoinhaber"><Input name="account_holder" /></Field>
              <Field label="IBAN"><Input name="iban" /></Field>
              <Field label="BIC / SWIFT"><Input name="bic" /></Field>
              <Field label="Bankname"><Input name="bank_name" /></Field>
              <Field label="Bankadresse optional"><Input name="bank_address" /></Field>
              <Field label="Standardkonto"><Select name="is_default" defaultValue="true"><option value="true">Ja</option><option value="false">Nein</option></Select></Field>
              <Field label="QR-Code hochladen optional"><Input name="qr_code" type="file" accept="image/*" /></Field>
              <div className="lg:col-span-2 flex justify-end"><Button type="submit">Bankverbindung speichern</Button></div>
            </form>
            <div className="space-y-2 text-sm text-slate-700">
              {bankAccounts.map((bank) => (
                <div key={bank.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="font-medium text-slate-950">{bank.label} · {bank.currency}</p>
                  <p>{bank.account_holder} · {bank.iban}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
