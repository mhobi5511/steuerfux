"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertWritableBuchhaltung, getSelectedBuchhaltung } from "@/lib/buchhaltungen";
import { convertToReportingCurrency, roundMoney } from "@/lib/currency";
import {
  calculateDueDate,
  calculateInvoiceItem,
  fromCents,
  toCents,
  type InvoiceItemInput
} from "@/lib/invoice-utils";
import {
  getVatExemptionSentence,
  getVatExemptionType
} from "@/lib/invoice-tax";
import { toNumber } from "@/lib/utils";
import type {
  BankAccount,
  BusinessCountry,
  CurrencyCode,
  Invoice,
  InvoiceSettings
} from "@/lib/db-types";

type ActionResult = { success?: string; error?: string; invoiceId?: string };

async function getInvoiceContext(writable = false) {
  const { supabase, user } = await requireUser();
  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  const { activeBuchhaltung } = await getSelectedBuchhaltung(supabase, user, settings);
  const writeError = writable ? assertWritableBuchhaltung(activeBuchhaltung) : null;
  return { supabase, user, activeBuchhaltung, settings, writeError };
}

function parseItems(raw: FormDataEntryValue | null, currency: CurrencyCode, kleinunternehmer: boolean) {
  let parsed: InvoiceItemInput[] = [];
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    throw new Error("Positionen konnten nicht gelesen werden.");
  }

  return parsed
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      description: item.description ? String(item.description) : null,
      quantity: Number(item.quantity),
      unit: item.unit ? String(item.unit) : null,
      unitPrice: Number(item.unitPrice),
      currency,
      vatRate: kleinunternehmer ? 0 : Number(item.vatRate || 0)
    }))
    .filter((item) => item.title || item.quantity || item.unitPrice);
}

async function ensureInvoiceSettings(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  buchhaltungId: string,
  country: BusinessCountry
) {
  const { data: existing } = await supabase
    .from("invoice_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("buchhaltung_id", buchhaltungId)
    .maybeSingle();
  if (existing) return existing as InvoiceSettings;

  const { data } = await supabase
    .from("invoice_settings")
    .insert({
      user_id: userId,
      buchhaltung_id: buchhaltungId,
      sender_country: country,
      invoice_prefix: "RG",
      next_invoice_number: 1,
      yearly_reset: true,
      default_payment_term: "1 Monat",
      default_kleinunternehmer: false,
      default_payment_qr_enabled: false,
      default_use_uploaded_qr: false
    })
    .select("*")
    .single();

  return data as InvoiceSettings;
}

function buildCustomerSnapshot(formData: FormData) {
  return {
    company_name: String(formData.get("customer_company_name") ?? "").trim(),
    contact_name: String(formData.get("customer_contact_name") ?? "").trim() || null,
    street: String(formData.get("customer_street") ?? "").trim(),
    postal_code: String(formData.get("customer_postal_code") ?? "").trim(),
    city: String(formData.get("customer_city") ?? "").trim(),
    country: String(formData.get("customer_country") ?? "").trim(),
    email: String(formData.get("customer_email") ?? "").trim()
  };
}

function buildSenderSnapshot(settings: InvoiceSettings) {
  return {
    name: settings.sender_name,
    addition: settings.sender_addition,
    street: settings.sender_street,
    postal_code: settings.sender_postal_code,
    city: settings.sender_city,
    country: settings.sender_country,
    email: settings.sender_email,
    phone: settings.sender_phone,
    tax_id: settings.sender_tax_id
  };
}

function buildBankSnapshot(bank: BankAccount | null) {
  if (!bank) return null;
  return {
    label: bank.label,
    currency: bank.currency,
    account_holder: bank.account_holder,
    iban: bank.iban,
    bic: bank.bic,
    bank_name: bank.bank_name,
    bank_address: bank.bank_address,
    qr_storage_path: bank.qr_storage_path
  };
}

function buildQrPaymentSnapshot({
  bank,
  generatedEnabled,
  useUploadedQr,
  invoiceNumber
}: {
  bank: BankAccount | null;
  generatedEnabled: boolean;
  useUploadedQr: boolean;
  invoiceNumber?: string | null;
}) {
  const uploadedQrStoragePath = bank?.qr_storage_path ?? null;
  const mode = useUploadedQr && uploadedQrStoragePath
    ? "uploaded"
    : generatedEnabled
      ? "generated"
      : "none";

  return {
    mode,
    generated_enabled: generatedEnabled,
    use_uploaded_qr: useUploadedQr,
    uploaded_qr_storage_path: uploadedQrStoragePath,
    payment_purpose: invoiceNumber ? `Rechnung ${invoiceNumber}` : null
  };
}

function safeUploadName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "qr-code";
}

export async function saveInvoiceDraft(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };

  const invoiceId = String(formData.get("id") ?? "");
  const currency = String(formData.get("currency") ?? activeBuchhaltung.reporting_currency) as CurrencyCode;
  const issueDate = String(formData.get("issue_date") ?? new Date().toISOString().slice(0, 10));
  const paymentTerm = String(formData.get("payment_term") ?? "1 Monat");
  const dueDate = calculateDueDate(issueDate, paymentTerm, String(formData.get("custom_due_date") ?? ""));
  const taxExempt = formData.get("kleinunternehmer") === "true";
  const customerSnapshot = buildCustomerSnapshot(formData);

  if (!customerSnapshot.company_name || !customerSnapshot.street || !customerSnapshot.postal_code || !customerSnapshot.city || !customerSnapshot.country || !customerSnapshot.email) {
    return { error: "Bitte vollständige Empfängeradresse erfassen." };
  }

  const invoiceSettings = await ensureInvoiceSettings(
    supabase,
    user.id,
    activeBuchhaltung.id,
    activeBuchhaltung.country
  );
  if (!invoiceSettings.sender_name || !invoiceSettings.sender_street || !invoiceSettings.sender_postal_code || !invoiceSettings.sender_city || !invoiceSettings.sender_country || !invoiceSettings.sender_email) {
    return { error: "Bitte zuerst die Ausstellerdaten in den Rechnungseinstellungen erfassen." };
  }

  let items: InvoiceItemInput[];
  try {
    items = parseItems(formData.get("items_json"), currency, taxExempt);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Positionen sind ungültig." };
  }

  if (!items.length) return { error: "Bitte mindestens eine Rechnungsposition erfassen." };
  if (items.some((item) => item.quantity <= 0 || item.unitPrice < 0 || !item.title)) {
    return { error: "Bitte Positionen mit Titel, Menge > 0 und gültigem Einzelpreis erfassen." };
  }

  const customerId = String(formData.get("customer_id") ?? "") || null;
  const saveCustomer = formData.get("save_customer") === "true";
  let resolvedCustomerId = customerId;

  if (saveCustomer && !customerId) {
    const { data: customer, error } = await supabase
      .from("customers")
      .insert({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung.id,
        company_name: customerSnapshot.company_name,
        contact_name: customerSnapshot.contact_name,
        street: customerSnapshot.street,
        postal_code: customerSnapshot.postal_code,
        city: customerSnapshot.city,
        country: customerSnapshot.country,
        email: customerSnapshot.email
      })
      .select("id")
      .single();
    if (error) return { error: "Empfänger konnte nicht gespeichert werden." };
    resolvedCustomerId = customer.id;
  }

  const bankAccountId = String(formData.get("bank_account_id") ?? "") || null;
  const { data: bankAccount } = bankAccountId
    ? await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", bankAccountId)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
        .maybeSingle()
    : { data: null };
  const typedBankAccount = bankAccount as BankAccount | null;
  const generatedPaymentQrEnabled = formData.get("payment_qr_enabled") === "true";
  const useUploadedQr = formData.get("use_uploaded_qr") === "true";
  const taxExemptionType = taxExempt ? getVatExemptionType(activeBuchhaltung.country) : null;
  const taxNote = taxExempt ? getVatExemptionSentence(activeBuchhaltung.country) : null;

  const calculatedItems = items.map((item) => ({ ...item, ...calculateInvoiceItem(item) }));
  const totals = calculatedItems.reduce(
    (sum, item) => ({
      net: sum.net + item.netAmountCents,
      vat: sum.vat + item.vatAmountCents,
      gross: sum.gross + item.grossAmountCents
    }),
    { net: 0, vat: 0, gross: 0 }
  );

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung.id,
    customer_id: resolvedCustomerId,
    bank_account_id: bankAccountId,
    issue_date: issueDate,
    payment_term: paymentTerm,
    due_date: dueDate,
    currency,
    kleinunternehmer: taxExempt,
    customer_snapshot: customerSnapshot,
    sender_snapshot: buildSenderSnapshot(invoiceSettings),
    bank_snapshot: buildBankSnapshot(typedBankAccount),
    qr_payment_snapshot: buildQrPaymentSnapshot({
      bank: typedBankAccount,
      generatedEnabled: generatedPaymentQrEnabled,
      useUploadedQr,
      invoiceNumber: null
    }),
    vat_exemption_type: taxExemptionType,
    tax_note: taxNote,
    notes: String(formData.get("notes") ?? "").trim() || null,
    net_total_cents: totals.net,
    vat_total_cents: totals.vat,
    gross_total_cents: totals.gross
  };

  const { data: invoice, error } = invoiceId
    ? await supabase
        .from("invoices")
        .update(payload)
        .eq("id", invoiceId)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
        .eq("status", "Entwurf")
        .select("id")
        .single()
    : await supabase.from("invoices").insert(payload).select("id").single();

  if (error || !invoice?.id) return { error: "Rechnung konnte nicht gespeichert werden." };

  await supabase
    .from("invoice_items")
    .delete()
    .eq("invoice_id", invoice.id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id);

  await supabase.from("invoice_items").insert(
    calculatedItems.map((item, index) => ({
      invoice_id: invoice.id,
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung.id,
      sort_order: index + 1,
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_cents: item.unitPriceCents,
      currency,
      vat_rate: item.vatRate,
      net_amount_cents: item.netAmountCents,
      vat_amount_cents: item.vatAmountCents,
      gross_amount_cents: item.grossAmountCents
    }))
  );

  revalidatePath("/rechnungen");
  return { success: "Rechnung wurde als Entwurf gespeichert.", invoiceId: invoice.id };
}

export async function issueInvoice(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };

  const invoiceId = String(formData.get("id") ?? "");
  const { data, error } = await supabase.rpc("issue_invoice", { p_invoice_id: invoiceId });
  if (error) return { error: error.message || "Rechnung konnte nicht ausgestellt werden." };
  if (data) {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("qr_payment_snapshot")
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .maybeSingle();
    const qrPaymentSnapshot = (invoice?.qr_payment_snapshot ?? {}) as Record<string, unknown>;
    await supabase
      .from("invoices")
      .update({
        qr_payment_snapshot: {
          ...qrPaymentSnapshot,
          payment_purpose: `Rechnung ${data}`
        }
      })
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id);
  }

  revalidatePath("/rechnungen");
  return { success: `Rechnung ${data} wurde ausgestellt.`, invoiceId };
}

export async function cancelInvoice(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase
    .from("invoices")
    .update({ status: "Storniert" })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung?.id);
  if (error) return { error: "Rechnung konnte nicht storniert werden." };
  revalidatePath("/rechnungen");
  return { success: "Rechnung wurde storniert." };
}

export async function duplicateInvoice(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };
  const id = String(formData.get("id") ?? "");

  const { data: source } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .maybeSingle();
  if (!source) return { error: "Rechnung wurde nicht gefunden." };

  const today = new Date().toISOString().slice(0, 10);
  const { data: copy, error } = await supabase
    .from("invoices")
    .insert({
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung.id,
      customer_id: source.customer_id,
      bank_account_id: source.bank_account_id,
      status: "Entwurf",
      issue_date: today,
      payment_term: source.payment_term,
      due_date: calculateDueDate(today, source.payment_term),
      currency: source.currency,
      kleinunternehmer: source.kleinunternehmer,
      customer_snapshot: source.customer_snapshot,
      sender_snapshot: source.sender_snapshot,
      bank_snapshot: source.bank_snapshot,
      qr_payment_snapshot: {
        ...(source.qr_payment_snapshot ?? {}),
        payment_purpose: null
      },
      vat_exemption_type: source.vat_exemption_type,
      tax_note: source.tax_note,
      notes: source.notes,
      net_total_cents: source.net_total_cents,
      vat_total_cents: source.vat_total_cents,
      gross_total_cents: source.gross_total_cents
    })
    .select("id")
    .single();
  if (error || !copy?.id) return { error: "Rechnung konnte nicht dupliziert werden." };

  await supabase.from("invoice_items").insert(
    (source.invoice_items ?? []).map((item: Record<string, unknown>) => ({
      invoice_id: copy.id,
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung.id,
      sort_order: item.sort_order,
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_cents: item.unit_price_cents,
      currency: item.currency,
      vat_rate: item.vat_rate,
      net_amount_cents: item.net_amount_cents,
      vat_amount_cents: item.vat_amount_cents,
      gross_amount_cents: item.gross_amount_cents
    }))
  );

  revalidatePath("/rechnungen");
  return { success: "Rechnung wurde dupliziert.", invoiceId: copy.id };
}

export async function recordInvoicePayment(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, settings, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };
  const invoiceId = String(formData.get("invoice_id") ?? "");

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .maybeSingle();
  if (!invoice) return { error: "Rechnung wurde nicht gefunden." };

  const paymentDate = String(formData.get("payment_date") ?? "");
  const amount = toNumber(formData.get("amount"), 0);
  const fee = toNumber(formData.get("fee"), 0);
  const currency = String(formData.get("currency") ?? invoice.currency) as CurrencyCode;
  const exchangeRate = toNumber(formData.get("exchange_rate"), 1);
  const exchangeRateSource = "manuell";
  if (!paymentDate || amount <= 0) return { error: "Bitte Zahlungsdatum und Betrag erfassen." };

  const amountReporting = convertToReportingCurrency(
    amount,
    currency,
    activeBuchhaltung.reporting_currency,
    exchangeRate
  );
  const invoiceAmountOriginal = fromCents(invoice.gross_total_cents);
  const invoiceAmountReporting = convertToReportingCurrency(
    invoiceAmountOriginal,
    invoice.currency,
    activeBuchhaltung.reporting_currency,
    exchangeRate
  );
  const paidTotalCents = (invoice.paid_total_cents ?? 0) + toCents(amount);
  const status = paidTotalCents >= invoice.gross_total_cents ? "Bezahlt" : "Teilweise bezahlt";

  const customer = invoice.customer_snapshot as Record<string, string>;
  const incomePayload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung.id,
    invoice_id: invoice.id,
    invoice_date: invoice.issue_date,
    payment_date: paymentDate,
    customer_project: `${invoice.invoice_number ?? "Rechnung"} · ${customer.company_name ?? "Kunde"}`,
    category: "Rechnung",
    invoice_amount_original: invoiceAmountOriginal,
    payment_received_original: amount,
    currency,
    tax_mode: "BRUTTO",
    exchange_rate: exchangeRate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: true,
    reporting_currency: activeBuchhaltung.reporting_currency,
    invoice_amount_reporting: invoiceAmountReporting,
    payment_received_reporting: amountReporting,
    difference_original: roundMoney(invoiceAmountOriginal - amount),
    difference_reporting: roundMoney(invoiceAmountReporting - amountReporting),
    status: status === "Bezahlt" ? "bezahlt" : "offen",
    description: `Zahlung zu Rechnung ${invoice.invoice_number ?? invoice.id}`
  };

  const { data: income, error: incomeError } = invoice.income_id
    ? await supabase
        .from("incomes")
        .update(incomePayload)
        .eq("id", invoice.income_id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
        .select("id")
        .single()
    : await supabase.from("incomes").insert(incomePayload).select("id").single();
  if (incomeError || !income?.id) return { error: "Zahlung konnte nicht als Einnahme gespeichert werden." };

  await supabase.from("invoice_payments").insert({
    invoice_id: invoice.id,
    income_id: income.id,
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung.id,
    payment_date: paymentDate,
    amount_cents: toCents(amount),
    currency,
    fee_cents: toCents(fee),
    note: String(formData.get("note") ?? "").trim() || null
  });

  await supabase
    .from("invoices")
    .update({ paid_total_cents: paidTotalCents, status, income_id: income.id })
    .eq("id", invoice.id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id);

  if (fee > 0) {
    const feeReporting = convertToReportingCurrency(
      fee,
      currency,
      activeBuchhaltung.reporting_currency,
      exchangeRate
    );
    await supabase.from("bank_fees").insert({
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung.id,
      fee_date: paymentDate,
      original_amount: fee,
      currency,
      fee_type: "Zahlungsanbieter",
      description: `Gebühr zu Rechnung ${invoice.invoice_number ?? invoice.id}`,
      exchange_rate: exchangeRate,
      exchange_rate_source: exchangeRateSource,
      exchange_rate_manual: true,
      reporting_currency: activeBuchhaltung.reporting_currency,
      amount_reporting: feeReporting
    });
  }

  revalidatePath("/rechnungen");
  revalidatePath("/einnahmen");
  revalidatePath("/dashboard");
  return { success: "Zahlung wurde erfasst und als Einnahme verknüpft.", invoiceId: invoice.id };
}

export async function saveInvoiceSettings(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung.id,
    sender_name: String(formData.get("sender_name") ?? "").trim() || null,
    sender_addition: String(formData.get("sender_addition") ?? "").trim() || null,
    sender_street: String(formData.get("sender_street") ?? "").trim() || null,
    sender_postal_code: String(formData.get("sender_postal_code") ?? "").trim() || null,
    sender_city: String(formData.get("sender_city") ?? "").trim() || null,
    sender_country: String(formData.get("sender_country") ?? activeBuchhaltung.country).trim() || null,
    sender_email: String(formData.get("sender_email") ?? "").trim() || null,
    sender_phone: String(formData.get("sender_phone") ?? "").trim() || null,
    sender_tax_id: String(formData.get("sender_tax_id") ?? "").trim() || null,
    invoice_prefix: String(formData.get("invoice_prefix") ?? "RG").trim() || "RG",
    next_invoice_number: Math.max(1, Math.round(toNumber(formData.get("next_invoice_number"), 1))),
    yearly_reset: formData.get("yearly_reset") === "true",
    default_payment_term: String(formData.get("default_payment_term") ?? "1 Monat"),
    default_kleinunternehmer: formData.get("default_kleinunternehmer") === "true",
    default_payment_qr_enabled: formData.get("default_payment_qr_enabled") === "true",
    default_use_uploaded_qr: formData.get("default_use_uploaded_qr") === "true"
  };

  const { error } = await supabase
    .from("invoice_settings")
    .upsert(payload, { onConflict: "buchhaltung_id" });
  if (error) return { error: "Rechnungseinstellungen konnten nicht gespeichert werden." };
  revalidatePath("/rechnungen");
  return { success: "Rechnungseinstellungen wurden gespeichert." };
}

export async function saveBankAccount(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };

  const id = String(formData.get("id") ?? "");
  let qrStoragePath: string | null = null;
  const qrCode = formData.get("qr_code");
  if (qrCode instanceof File && qrCode.size > 0) {
    if (!qrCode.type.startsWith("image/")) {
      return { error: "Der hochgeladene QR-Code muss eine Bilddatei sein." };
    }
    const storagePath = `${user.id}/${activeBuchhaltung.id}/qr/${crypto.randomUUID()}-${safeUploadName(qrCode.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("invoice-assets")
      .upload(storagePath, qrCode, {
        cacheControl: "3600",
        contentType: qrCode.type,
        upsert: false
      });
    if (uploadError) return { error: "QR-Code konnte nicht hochgeladen werden." };
    qrStoragePath = storagePath;
  }

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung.id,
    label: String(formData.get("label") ?? "").trim(),
    currency: String(formData.get("currency") ?? activeBuchhaltung.reporting_currency) as CurrencyCode,
    account_holder: String(formData.get("account_holder") ?? "").trim(),
    iban: String(formData.get("iban") ?? "").trim(),
    bic: String(formData.get("bic") ?? "").trim(),
    bank_name: String(formData.get("bank_name") ?? "").trim(),
    bank_address: String(formData.get("bank_address") ?? "").trim() || null,
    ...(qrStoragePath ? { qr_storage_path: qrStoragePath } : {}),
    is_default: formData.get("is_default") === "true"
  };

  if (!payload.label || !payload.account_holder || !payload.iban || !payload.bic || !payload.bank_name) {
    return { error: "Bitte Bankverbindung vollständig erfassen." };
  }

  if (payload.is_default) {
    await supabase
      .from("bank_accounts")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .eq("currency", payload.currency);
  }

  const { error } = id
    ? await supabase
        .from("bank_accounts")
        .update(payload)
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
    : await supabase.from("bank_accounts").insert(payload);
  if (error) return { error: "Bankverbindung konnte nicht gespeichert werden." };
  revalidatePath("/rechnungen");
  return { success: "Bankverbindung wurde gespeichert." };
}

export async function sendInvoiceEmail(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getInvoiceContext(true);
  if (writeError) return { error: writeError };
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewählt." };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVOICE_EMAIL_FROM;
  if (!apiKey || !from) return { error: "E-Mail-Versand ist nicht konfiguriert. PDF-Download funktioniert weiterhin." };

  const id = String(formData.get("invoice_id") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!to || !subject || !message) return { error: "Bitte Empfänger, Betreff und Nachricht erfassen." };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html: `<p>${message.replaceAll("\n", "<br />")}</p><p>Die Rechnung ist in der App als PDF abrufbar.</p>`
    })
  });

  if (!response.ok) return { error: "E-Mail konnte nicht versendet werden." };
  await supabase
    .from("invoices")
    .update({ status: "Versendet", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id);
  revalidatePath("/rechnungen");
  return { success: "Rechnung wurde per E-Mail versendet." };
}
