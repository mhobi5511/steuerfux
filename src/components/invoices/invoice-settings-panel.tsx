"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCustomer,
  saveBankAccount,
  saveCustomer,
  saveInvoiceSettings
} from "@/app/actions/invoices";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getVatExemptionSettingsLabel } from "@/lib/invoice-tax";
import type { BankAccount, Buchhaltung, Customer, InvoiceSettings } from "@/lib/db-types";

type Result = { success?: string; error?: string };

export function InvoiceSettingsPanel({
  activeBuchhaltung,
  invoiceSettings,
  bankAccounts,
  customers
}: {
  activeBuchhaltung: Buchhaltung | null;
  invoiceSettings: InvoiceSettings | null;
  bankAccounts: BankAccount[];
  customers: Customer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ success: string | null; error: string | null }>({ success: null, error: null });
  const [customerForm, setCustomerForm] = useState<Customer | "new" | null>(null);
  const country = activeBuchhaltung?.country ?? "Deutschland";
  const defaultCurrency = activeBuchhaltung?.reporting_currency ?? "EUR";

  function submit(action: (formData: FormData) => Promise<Result>, after?: () => void) {
    return (formData: FormData) => startTransition(async () => {
      setMessage({ success: null, error: null });
      const result = await action(formData);
      setMessage({ success: result.success ?? null, error: result.error ?? null });
      if (result.success) {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <FormFeedback success={message.success} error={message.error} />
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-950">Rechnungseinstellungen</h2>
        <form action={submit(saveInvoiceSettings)} className="grid gap-4 lg:grid-cols-2">
          <Field label="Name / Firmenname"><Input name="sender_name" defaultValue={invoiceSettings?.sender_name ?? ""} /></Field>
          <Field label="Zusatz optional"><Input name="sender_addition" defaultValue={invoiceSettings?.sender_addition ?? ""} /></Field>
          <Field label="Strasse"><Input name="sender_street" defaultValue={invoiceSettings?.sender_street ?? ""} /></Field>
          <Field label="PLZ"><Input name="sender_postal_code" defaultValue={invoiceSettings?.sender_postal_code ?? ""} /></Field>
          <Field label="Ort"><Input name="sender_city" defaultValue={invoiceSettings?.sender_city ?? ""} /></Field>
          <Field label="Land"><Input name="sender_country" defaultValue={invoiceSettings?.sender_country ?? country} /></Field>
          <Field label="E-Mail"><Input name="sender_email" type="email" defaultValue={invoiceSettings?.sender_email ?? ""} /></Field>
          <Field label="Telefon optional"><Input name="sender_phone" defaultValue={invoiceSettings?.sender_phone ?? ""} /></Field>
          <Field label="Steuernummer / UID optional"><Input name="sender_tax_id" defaultValue={invoiceSettings?.sender_tax_id ?? ""} /></Field>
          <Field label="Rechnungspräfix"><Input name="invoice_prefix" defaultValue={invoiceSettings?.invoice_prefix ?? "RG"} /></Field>
          <Field label="Nächste Rechnungsnummer"><Input name="next_invoice_number" type="number" defaultValue={invoiceSettings?.next_invoice_number ?? 1} /></Field>
          <Field label="Jährlicher Nummernreset"><Select name="yearly_reset" defaultValue={invoiceSettings?.yearly_reset === false ? "false" : "true"}><option value="true">Ja</option><option value="false">Nein</option></Select></Field>
          <Field label="Standard-Zahlungsziel"><Select name="default_payment_term" defaultValue={invoiceSettings?.default_payment_term ?? "1 Monat"}>{["sofort", "7 Tage", "14 Tage", "30 Tage", "1 Monat"].map((term) => <option key={term} value={term}>{term}</option>)}</Select></Field>
          <Field label={getVatExemptionSettingsLabel(country)}><Select name="default_kleinunternehmer" defaultValue={invoiceSettings?.default_kleinunternehmer ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
          <Field label="EPC-QR-Code für EUR-Rechnung anzeigen"><Select name="default_payment_qr_enabled" defaultValue={invoiceSettings?.default_payment_qr_enabled ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
          <Field label="Hochgeladenen QR-Code verwenden"><Select name="default_use_uploaded_qr" defaultValue={invoiceSettings?.default_use_uploaded_qr ? "true" : "false"}><option value="false">Nein</option><option value="true">Ja</option></Select></Field>
          <div className="lg:col-span-2 flex justify-end"><Button type="submit" disabled={pending}>Einstellungen speichern</Button></div>
        </form>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-950">Bankverbindungen</h2>
        <form action={submit(saveBankAccount)} className="grid gap-4 lg:grid-cols-2" encType="multipart/form-data">
          <Field label="Bezeichnung"><Input name="label" placeholder="EUR Konto" required /></Field>
          <Field label="Währung"><Select name="currency" defaultValue={defaultCurrency}><option value="EUR">EUR</option><option value="CHF">CHF</option></Select></Field>
          <Field label="Kontoinhaber"><Input name="account_holder" required /></Field>
          <Field label="IBAN"><Input name="iban" required /></Field>
          <Field label="BIC / SWIFT"><Input name="bic" required /></Field>
          <Field label="Bankname"><Input name="bank_name" required /></Field>
          <Field label="Bankadresse optional"><Input name="bank_address" /></Field>
          <Field label="Standardkonto"><Select name="is_default" defaultValue="true"><option value="true">Ja</option><option value="false">Nein</option></Select></Field>
          <Field label="QR-Code hochladen optional"><Input name="qr_code" type="file" accept="image/*" /></Field>
          <div className="lg:col-span-2 flex justify-end"><Button type="submit" disabled={pending}>Bankverbindung speichern</Button></div>
        </form>
        <div className="space-y-2 text-sm text-slate-700">
          {bankAccounts.map((bank) => <div key={bank.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"><span className="font-medium text-slate-950">{bank.label} · {bank.currency}</span><span>{bank.account_holder} · {bank.iban}</span>{bank.is_default ? <span className="text-slate-500">Standard</span> : null}</div>)}
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">Empfänger</h2>
          <Button type="button" onClick={() => setCustomerForm("new")}>Empfänger hinzufügen</Button>
        </div>
        <div className="space-y-2">
          {customers.map((customer) => (
            <div key={customer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <div><p className="font-medium text-slate-950">{customer.company_name}</p><p className="text-slate-600">{[customer.contact_name, `${customer.postal_code} ${customer.city}`, customer.country, customer.email].filter(Boolean).join(" · ")}</p></div>
              <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => setCustomerForm(customer)}>Bearbeiten</Button><Button type="button" variant="danger" onClick={() => { if (confirm("Empfänger wirklich löschen?")) { const data = new FormData(); data.set("id", customer.id); submit(deleteCustomer)(data); } }}>Löschen</Button></div>
            </div>
          ))}
          {customers.length === 0 ? <p className="text-sm text-slate-500">Noch keine Empfänger gespeichert.</p> : null}
        </div>
        {customerForm ? (
          <form action={submit(saveCustomer, () => setCustomerForm(null))} className="grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2">
            {customerForm !== "new" ? <input type="hidden" name="id" value={customerForm.id} /> : null}
            <Field label="Firma / Name"><Input name="company_name" required defaultValue={customerForm === "new" ? "" : customerForm.company_name} /></Field>
            <Field label="Ansprechpartner optional"><Input name="contact_name" defaultValue={customerForm === "new" ? "" : customerForm.contact_name ?? ""} /></Field>
            <Field label="Strasse"><Input name="street" required defaultValue={customerForm === "new" ? "" : customerForm.street} /></Field>
            <Field label="PLZ"><Input name="postal_code" required defaultValue={customerForm === "new" ? "" : customerForm.postal_code} /></Field>
            <Field label="Ort"><Input name="city" required defaultValue={customerForm === "new" ? "" : customerForm.city} /></Field>
            <Field label="Land"><Input name="country" required defaultValue={customerForm === "new" ? country : customerForm.country} /></Field>
            <Field label="E-Mail"><Input name="email" type="email" required defaultValue={customerForm === "new" ? "" : customerForm.email} /></Field>
            <Field label="Telefon optional"><Input name="phone" defaultValue={customerForm === "new" ? "" : customerForm.phone ?? ""} /></Field>
            <div className="lg:col-span-2 flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button type="button" variant="secondary" onClick={() => setCustomerForm(null)}>Abbrechen</Button><Button type="submit" disabled={pending}>Empfänger speichern</Button></div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
