"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recordInvoicePayment } from "@/app/actions/invoices";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reconcileInvoice } from "@/lib/invoice-accounting";
import { formatCents } from "@/lib/invoice-utils";
import type { CurrencyCode, Invoice } from "@/lib/db-types";

export function InvoicePaymentForm({ invoice, reportingCurrency }: { invoice: Invoice; reportingCurrency: CurrencyCode }) {
  const state = reconcileInvoice(invoice);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(state.remainingCents / 100);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retry, setRetry] = useState<Record<string, string> | null>(null);
  const [manual, setManual] = useState(false);
  const storageKey = `invoice-payment:${invoice.user_id}:${invoice.buchhaltung_id}:${invoice.id}`;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) { setRetry(JSON.parse(stored)); setOpen(true); }
    } catch { setError("Der lokale Zahlungsschutz ist nicht verfügbar. Bitte Browserspeicher aktivieren."); }
  }, [storageKey]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const overpaid = Math.max(0, Math.round(amount * 100) - state.remainingCents);
  if (!open && !retry && state.remainingCents === 0) return success ? <p role="status">{success}</p> : null;

  async function save(formData: FormData) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const payload = retry ?? { ...Object.fromEntries(formData) as Record<string, string>, request_id: crypto.randomUUID() };
      // Persist the exact operation BEFORE sending. A lost response survives refresh/reopen.
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setRetry(payload);
      const request = new FormData();
      for (const [key, value] of Object.entries(payload)) request.set(key, value);
      const result = await recordInvoicePayment(request);
      if (result.error) {
        setError(result.error);
        if (result.rejected) { localStorage.removeItem(storageKey); setRetry(null); }
      } else {
        localStorage.removeItem(storageKey); setRetry(null); setOpen(false);
        setSuccess(result.success ?? "Zahlung gespeichert."); router.refresh();
      }
    } catch {
      setError("Keine eindeutige Bestätigung erhalten. Bitte dieselbe Zahlung erneut prüfen/speichern; sie wird höchstens einmal gebucht.");
    } finally { busy.current = false; setPending(false); }
  }

  return <>
    <Button type="button" variant="ghost" onClick={() => { setAmount(state.remainingCents / 100); setOpen(true); }}>
      {retry ? "Zahlung prüfen" : "Zahlung erfassen"}
    </Button>
    {success ? <p role="status">{success}</p> : null}
    {open ? <dialog ref={dialog} onCancel={(event) => { if (pending) event.preventDefault(); else setOpen(false); }} className="max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50 dark:bg-slate-900 dark:text-slate-100" aria-label="Zahlung erfassen">
        <h2 className="text-lg font-semibold">Zahlung erfassen · {invoice.invoice_number}</h2>
        <dl className="my-4 grid grid-cols-2 gap-2">
          <dt>Rechnungsbetrag</dt><dd>{formatCents(invoice.gross_total_cents, invoice.currency)}</dd>
          <dt>Bereits bezahlt</dt><dd>{formatCents(state.receivedCents, invoice.currency)}</dd>
          <dt>Gebührenausgleich</dt><dd>{formatCents(state.feeCents, invoice.currency)}</dd>
          <dt>Offener Betrag</dt><dd>{formatCents(state.remainingCents, invoice.currency)}</dd>
        </dl>
        {state.legacy ? <p role="alert">Historische Zahlungen müssen zuerst abgestimmt werden. Weitere Zahlungen sind gesperrt.</p> : null}
        {error ? <p className="my-3 text-rose-700" role="alert">{error}</p> : null}
        <form action={save} className="grid gap-3">
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <input type="hidden" name="buchhaltung_id" value={invoice.buchhaltung_id} />
          <input type="hidden" name="expected_settled_cents" value={state.settledCents} />
          {retry ? <p className="rounded-xl bg-amber-50 p-3 text-amber-900">Ausstehende Bestätigung: {retry.payment_date} · {retry.currency} {retry.amount}. Erneutes Speichern prüft exakt diese Zahlung.</p> : <>
            <Field label="Zahlungsdatum"><Input autoFocus name="payment_date" type="date" required defaultValue={today} max={today} /></Field>
            <Field label="Betrag erhalten"><Input name="amount" type="number" min="0.01" max="21474836.47" step="0.01" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
            <Field label="Währung"><Input name="currency" readOnly value={invoice.currency} /></Field>
            <input type="hidden" name="exchange_rate_manual" value={manual ? "true" : "false"} />
            {invoice.currency !== reportingCurrency ? <>
              <p>Berichtswährung {reportingCurrency}. Der historische CHF/EUR-Kurs wird zum Zahlungsdatum geladen und fest gespeichert.</p>
              <label><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Kurs manuell bestätigen</label>
              {manual ? <Field label="Wechselkurs CHF → EUR"><Input name="exchange_rate" type="number" min="0.000001" step="0.000001" required /></Field> : null}
            </> : null}
            <Field label="Bereits abgezogene Gebühr / vereinbarter Abzug (optional)" hint="Nur einen ausdrücklich vereinbarten Ausgleich eintragen. Der Betrag wird nicht als Zahlungseingang gezählt.">
              <Input name="fee" type="number" step="0.01" min="0" defaultValue="0" />
            </Field>
            <Field label="Notiz (bei Gebührenausgleich erforderlich)"><Textarea name="note" maxLength={2000} /></Field>
            {overpaid > 0 ? <label className="rounded-xl bg-amber-50 p-3 text-amber-900">
              Der erfasste Betrag liegt {formatCents(overpaid, invoice.currency)} über dem offenen Rechnungsbetrag.
              <span className="mt-2 block"><input name="confirm_overpayment" type="checkbox" value="true" required /> Überzahlung bewusst vollständig erfassen.</span>
            </label> : <input name="confirm_overpayment" type="hidden" value="false" />}
          </>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Schließen</Button>
            <Button type="submit" disabled={pending || state.legacy}>{pending ? "Wird gespeichert…" : retry ? "Zahlung prüfen / erneut speichern" : "Speichern"}</Button>
          </div>
        </form>
    </dialog> : null}
  </>;
}
