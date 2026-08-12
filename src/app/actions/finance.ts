"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import {
  applyBuchhaltungSettings,
  assertWritableBuchhaltung,
  getSelectedBuchhaltung,
  selectedBuchhaltungCookie
} from "@/lib/buchhaltungen";
import {
  convertToReportingCurrency,
  fetchHistoricalChfEurRate,
  getReportingCurrency,
  roundMoney
} from "@/lib/currency";
import { calculateDepreciationSummary, getDepreciationSuggestion } from "@/lib/depreciation";
import {
  bankFeeSchema,
  depreciationSchema,
  expenseSchema,
  incomeSchema,
  reimbursementSchema,
  settingsSchema
} from "@/lib/schemas";
import { isIncomePaid, normalizeIncomeStatus } from "@/lib/income-status";
import { buildPerDiemBreakdown, calculateTripTotals, validateTripChronology } from "@/lib/trips";
import { toBoolean, toNumber } from "@/lib/utils";
import type { AppSettings, BusinessCountry, CurrencyCode, ReportingCurrency } from "@/lib/db-types";

type ActionResult = { success?: string; error?: string };

async function getUserSettings(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]
): Promise<AppSettings | null> {
  const { data } = await supabase.from("settings").select("*").maybeSingle();
  return data as AppSettings | null;
}

async function getActionContext(writable = false) {
  const { supabase, user } = await requireUser();
  const rawSettings = await getUserSettings(supabase);
  const { buchhaltungen, activeBuchhaltung } = await getSelectedBuchhaltung(
    supabase,
    user,
    rawSettings
  );
  const writeError = writable ? assertWritableBuchhaltung(activeBuchhaltung) : null;

  return {
    supabase,
    user,
    settings: applyBuchhaltungSettings(rawSettings, activeBuchhaltung) as AppSettings | null,
    buchhaltungen,
    activeBuchhaltung,
    writeError
  };
}

function getReportingContext(settings: AppSettings | null) {
  const businessCountry = settings?.business_country ?? "Deutschland";
  const reportingCurrency =
    settings?.reporting_currency ?? getReportingCurrency(businessCountry);
  const fallbackRate = settings?.default_manual_chf_eur_rate ?? 1;

  return {
    businessCountry,
    reportingCurrency,
    fallbackRate
  };
}

async function cacheExchangeRate(
  date: string,
  rate: number,
  source: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]
) {
  await supabase.from("exchange_rates").upsert(
    {
      user_id: userId,
      rate_date: date,
      base_currency: "CHF",
      quote_currency: "EUR",
      rate,
      source
    },
    { onConflict: "user_id,rate_date,base_currency,quote_currency" }
  );
}

async function upsertExpenseDepreciation({
  supabase,
  userId,
  expenseId,
  buchhaltungId,
  values,
  reportingCurrency,
  reportingAmount,
  exchangeRateSource
}: {
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
  userId: string;
  expenseId: string;
  buchhaltungId: string;
  values: {
    description: string;
    original_amount: number;
    currency: CurrencyCode;
    exchange_rate: number;
    exchange_rate_manual: boolean;
    acquisition_date?: string | null;
    useful_life_years?: number | null;
    note?: string | null;
  };
  reportingCurrency: ReportingCurrency;
  reportingAmount: number;
  exchangeRateSource: string;
}) {
  if (!values.acquisition_date || !values.useful_life_years) return;

  const acquisitionYear = new Date(values.acquisition_date).getFullYear();
  const currentYear = new Date().getFullYear();
  const summary = calculateDepreciationSummary(
    reportingAmount,
    values.useful_life_years,
    acquisitionYear,
    currentYear
  );

  const payload = {
    user_id: userId,
    buchhaltung_id: buchhaltungId,
    linked_expense_id: expenseId,
    description: values.description,
    original_amount: values.original_amount,
    currency: values.currency,
    exchange_rate: values.exchange_rate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: values.exchange_rate_manual,
    reporting_currency: reportingCurrency,
    amount_reporting: reportingAmount,
    acquisition_date: values.acquisition_date,
    useful_life_years: values.useful_life_years,
    yearly_amount_reporting: summary.yearlyAmountReporting,
    deducted_until_year_reporting: summary.deductedUntilYearReporting,
    remaining_value_reporting: summary.remainingValueReporting,
    remaining_years: summary.remainingYears,
    method: "linear",
    note: values.note ?? null
  };

  const { data: existing } = await supabase
    .from("depreciations")
    .select("id")
    .eq("linked_expense_id", expenseId)
    .eq("user_id", userId)
    .eq("buchhaltung_id", buchhaltungId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("depreciations")
      .update(payload)
      .eq("id", existing.id)
      .eq("user_id", userId)
      .eq("buchhaltung_id", buchhaltungId);
  } else {
    await supabase.from("depreciations").insert(payload);
  }
}

async function removeLegacyExpenseReimbursement(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  expenseId: string
) {
  await supabase
    .from("reimbursements")
    .delete()
    .eq("source_expense_id", expenseId)
    .eq("user_id", userId);

  await supabase
    .from("expenses")
    .update({ reimbursement_id: null })
    .eq("id", expenseId)
    .eq("user_id", userId);
}

async function removeTripReimbursement(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  tripId: string
) {
  await supabase
    .from("reimbursements")
    .delete()
    .eq("source_trip_id", tripId)
    .eq("user_id", userId);

  await supabase
    .from("trips")
    .update({ reimbursement_id: null })
    .eq("id", tripId)
    .eq("user_id", userId);
}

export async function upsertIncome(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { reportingCurrency } = getReportingContext(settings);

  const parsed = incomeSchema.safeParse({
    invoice_date: formData.get("invoice_date"),
    payment_date: formData.get("payment_date") || null,
    customer_project: formData.get("customer_project"),
    category: formData.get("category") || null,
    invoice_amount_original: formData.get("invoice_amount_original"),
    payment_received_original: formData.get("payment_received_original") || null,
    currency: formData.get("currency"),
    tax_mode: formData.get("tax_mode") || "BRUTTO",
    exchange_rate: formData.get("exchange_rate") || 1,
    exchange_rate_manual: toBoolean(formData.get("exchange_rate_manual")),
    status: formData.get("status") || null,
    description: formData.get("description") || null
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "UngÃ¼ltige Eingabe." };
  }

  const values = parsed.data;
  const hasPaymentDate = Boolean(values.payment_date);
  const paymentReceivedOriginal = hasPaymentDate
    ? (values.payment_received_original ?? values.invoice_amount_original)
    : 0;
  const derivedStatus = hasPaymentDate && paymentReceivedOriginal > 0 ? "bezahlt" : "offen";
  const invoiceAmountReporting = convertToReportingCurrency(
    values.invoice_amount_original,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const paymentReceivedReporting = convertToReportingCurrency(
    paymentReceivedOriginal,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const differenceOriginal = roundMoney(
    values.invoice_amount_original - paymentReceivedOriginal
  );
  const differenceReporting = roundMoney(invoiceAmountReporting - paymentReceivedReporting);
  const incomeId = String(formData.get("id") ?? "");
  const exchangeRateSource = values.exchange_rate_manual ? "manuell" : "Frankfurter / ECB";

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung!.id,
    invoice_date: values.invoice_date,
    payment_date: values.payment_date || null,
    customer_project: values.customer_project,
    category: values.category?.trim() || "Allgemein",
    invoice_amount_original: values.invoice_amount_original,
    payment_received_original: paymentReceivedOriginal,
    currency: values.currency,
    tax_mode: values.tax_mode,
    exchange_rate: values.exchange_rate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: values.exchange_rate_manual,
    reporting_currency: reportingCurrency,
    invoice_amount_reporting: invoiceAmountReporting,
    payment_received_reporting: paymentReceivedReporting,
    difference_original: differenceOriginal,
    difference_reporting: differenceReporting,
    status: values.status ? normalizeIncomeStatus(values.status) : derivedStatus,
    description: values.description || null
  };
  const resolvedIncomeStatus = payload.status;

  const query = incomeId
    ? supabase.from("incomes").update(payload).eq("id", incomeId).eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id)
    : supabase.from("incomes").insert(payload).select("id").single();

  const { data, error } = await query;
  if (error) {
    console.error("upsertIncome error:", error);
    return { error: "Einnahme konnte nicht gespeichert werden." };
  }

  if (values.payment_date && (values.currency === "CHF" || reportingCurrency === "CHF")) {
    await cacheExchangeRate(
      values.payment_date,
      values.exchange_rate,
      exchangeRateSource,
      user.id,
      supabase
    );
  }

  const relatedIncomeId = incomeId || data?.id || null;

  if (relatedIncomeId && differenceReporting > 0.009 && isIncomePaid(resolvedIncomeStatus)) {
    await supabase.from("bank_fees").upsert(
      {
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        fee_date: values.payment_date || values.invoice_date,
        original_amount: differenceOriginal,
        currency: values.currency,
        fee_type: "Zahlungsdifferenz aus Einnahme",
        description: `Automatisch aus Einnahme: ${values.customer_project}`,
        exchange_rate: values.exchange_rate,
        exchange_rate_source: exchangeRateSource,
        exchange_rate_manual: values.exchange_rate_manual,
        reporting_currency: reportingCurrency,
        amount_reporting: differenceReporting,
        related_income_id: relatedIncomeId
      },
      { onConflict: "related_income_id,fee_type" }
    );
  } else if (relatedIncomeId) {
    await supabase
      .from("bank_fees")
      .delete()
      .eq("related_income_id", relatedIncomeId)
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung!.id)
      .eq("fee_type", "Zahlungsdifferenz aus Einnahme");
  }

  revalidatePath("/dashboard");
  revalidatePath("/einnahmen");
  revalidatePath("/bank-gebuehren");
  return { success: "Einnahme erfolgreich gespeichert." };
}

export async function deleteIncome(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");
  await supabase.from("incomes").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase
    .from("bank_fees")
    .delete()
    .eq("related_income_id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung!.id)
    .eq("fee_type", "Zahlungsdifferenz aus Einnahme");
  revalidatePath("/einnahmen");
  revalidatePath("/bank-gebuehren");
}

export async function upsertExpense(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { businessCountry, reportingCurrency } = getReportingContext(settings);

  const parsed = expenseSchema.safeParse({
    payment_date: formData.get("payment_date"),
    category: formData.get("category") || null,
    description: formData.get("description"),
    original_amount: formData.get("original_amount"),
    currency: formData.get("currency"),
    tax_mode: formData.get("tax_mode") || "BRUTTO",
    exchange_rate: formData.get("exchange_rate") || 1,
    exchange_rate_manual: toBoolean(formData.get("exchange_rate_manual")),
    deductible: toBoolean(formData.get("deductible")),
    deductible_percentage: formData.get("deductible_percentage"),
    receipt_available: toBoolean(formData.get("receipt_available")),
    note: formData.get("note") || null,
    is_depreciable: toBoolean(formData.get("is_depreciable")),
    acquisition_value: formData.get("acquisition_value") || null,
    acquisition_date: formData.get("acquisition_date") || null,
    useful_life_years: formData.get("useful_life_years") || null,
    depreciation_method: formData.get("depreciation_method") || null,
    reimbursable_to_client: toBoolean(formData.get("reimbursable_to_client")),
    client_share_percentage: formData.get("client_share_percentage") || 0,
    client_share_mode: formData.get("client_share_mode") || "fixed",
    client_share_fixed_amount: formData.get("client_share_fixed_amount") || null,
    client_share_fixed_currency: formData.get("client_share_fixed_currency") || null,
    client_share_fixed_exchange_rate: formData.get("client_share_fixed_exchange_rate") || null,
    client_share_fixed_exchange_rate_manual: toBoolean(
      formData.get("client_share_fixed_exchange_rate_manual")
    )
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "UngÃ¼ltige Ausgabe." };
  }

  const values = parsed.data;
  const amountReporting = convertToReportingCurrency(
    values.original_amount,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const deductibleAmountReporting = roundMoney(
    amountReporting * ((values.deductible ? values.deductible_percentage : 0) / 100)
  );
  const clientShareMode = values.reimbursable_to_client ? values.client_share_mode : "fixed";
  const clientShareFixedAmount =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? roundMoney(values.client_share_fixed_amount ?? 0)
      : null;
  const clientShareFixedCurrency =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? values.client_share_fixed_currency ?? values.currency
      : null;
  const clientShareFixedExchangeRate =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? clientShareFixedCurrency === reportingCurrency
        ? 1
        : values.client_share_fixed_exchange_rate ?? values.exchange_rate
      : null;
  const clientShareFixedExchangeRateManual =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? clientShareFixedCurrency === reportingCurrency
        ? false
        : values.client_share_fixed_exchange_rate_manual
      : false;

  const clientShareAmountOriginal =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? roundMoney(clientShareFixedAmount ?? 0)
      : roundMoney(values.original_amount * (values.client_share_percentage / 100));
  const clientShareAmountReporting =
    values.reimbursable_to_client && clientShareMode === "fixed"
      ? convertToReportingCurrency(
          clientShareFixedAmount ?? 0,
          clientShareFixedCurrency ?? values.currency,
          reportingCurrency,
          clientShareFixedExchangeRate ?? 1
        )
      : roundMoney(amountReporting * (values.client_share_percentage / 100));
  const clientSharePercentage = values.reimbursable_to_client
    ? amountReporting > 0
      ? roundMoney((clientShareAmountReporting / amountReporting) * 100)
      : 0
    : 0;
  const effectiveAmountReporting = roundMoney(
    Math.max(amountReporting - clientShareAmountReporting, 0)
  );
  const effectiveDeductibleAmountReporting = roundMoney(
    Math.max(deductibleAmountReporting - clientShareAmountReporting, 0)
  );
  const suggestion = getDepreciationSuggestion(
    businessCountry,
    amountReporting,
    values.category?.trim() || "Allgemein"
  );
  const expenseId = String(formData.get("id") ?? "");
  const exchangeRateSource = values.exchange_rate_manual ? "manuell" : "Frankfurter / ECB";

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung!.id,
    expense_date: values.payment_date,
    payment_date: values.payment_date,
    category: values.category?.trim() || "Allgemein",
    description: values.description,
    original_amount: values.original_amount,
    currency: values.currency,
    tax_mode: values.tax_mode,
    exchange_rate: values.exchange_rate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: values.exchange_rate_manual,
    reporting_currency: reportingCurrency,
    amount_reporting: amountReporting,
    deductible: values.deductible,
    deductible_percentage: values.deductible ? values.deductible_percentage : 0,
    deductible_amount_reporting: values.deductible ? deductibleAmountReporting : 0,
    effective_amount_reporting: effectiveAmountReporting,
    effective_deductible_amount_reporting: values.deductible
      ? effectiveDeductibleAmountReporting
      : 0,
    receipt_available: values.receipt_available,
    note: values.note,
    is_depreciable: values.is_depreciable,
    acquisition_value: values.acquisition_value ?? amountReporting,
    acquisition_date: values.acquisition_date || values.payment_date,
    useful_life_years: values.useful_life_years ?? (values.is_depreciable ? 3 : null),
    depreciation_method: values.depreciation_method ?? "linear",
    depreciation_warning: suggestion.warning,
    reimbursable_to_client: values.reimbursable_to_client,
    client_share_percentage: clientSharePercentage,
    client_share_mode: values.reimbursable_to_client ? clientShareMode : "fixed",
    client_share_fixed_amount: clientShareFixedAmount,
    client_share_fixed_currency: clientShareFixedCurrency,
    client_share_fixed_exchange_rate: clientShareFixedExchangeRate,
    client_share_fixed_exchange_rate_manual: clientShareFixedExchangeRateManual,
    client_share_amount_original: clientShareAmountOriginal,
    client_share_amount_reporting: clientShareAmountReporting,
    reimbursement_id: null
  };

  const { data, error } = expenseId
    ? await supabase
        .from("expenses")
        .update(payload)
        .eq("id", expenseId)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id)
        .select("id")
        .single()
    : await supabase.from("expenses").insert(payload).select("id").single();

  if (error || !data?.id) {
    console.error("upsertExpense error:", error);
    return { error: "Ausgabe konnte nicht gespeichert werden." };
  }

  if (values.is_depreciable) {
    await upsertExpenseDepreciation({
      supabase,
      userId: user.id,
      expenseId: data.id,
      buchhaltungId: activeBuchhaltung!.id,
      values,
      reportingCurrency,
      reportingAmount: amountReporting,
      exchangeRateSource
    });
  }

  await removeLegacyExpenseReimbursement(supabase, user.id, data.id);

  const receipt = formData.get("receipt_file");
  let receiptUploadFailed = false;
  if (receipt instanceof File && receipt.size > 0) {
    const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${user.id}/${activeBuchhaltung!.id}/${data.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(storagePath, receipt, {
        contentType: receipt.type || "application/octet-stream",
        upsert: true
      });

    if (uploadError) {
      console.error("receipt upload error:", uploadError);
      receiptUploadFailed = true;
    } else {
      await supabase
        .from("receipts")
        .delete()
        .eq("expense_id", data.id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id);
      const { error: receiptError } = await supabase.from("receipts").insert({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        expense_id: data.id,
        storage_path: storagePath,
        original_filename: receipt.name,
        mime_type: receipt.type || "application/octet-stream",
        file_size: receipt.size
      });
      if (receiptError) {
        console.error("receipt metadata error:", receiptError);
        receiptUploadFailed = true;
      } else {
        await supabase
          .from("expenses")
          .update({ receipt_available: true })
          .eq("id", data.id)
          .eq("user_id", user.id)
          .eq("buchhaltung_id", activeBuchhaltung!.id);
      }
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/ausgaben");
  revalidatePath("/abschreibungen");
  return {
    error: receiptUploadFailed
      ? "Ausgabe wurde gespeichert, Beleg konnte jedoch nicht hochgeladen werden."
      : undefined,
    success: suggestion.warning
      ? `Ausgabe erfolgreich gespeichert. ${suggestion.warning}`
      : "Ausgabe erfolgreich gespeichert."
  };
}

export async function deleteExpense(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");
  const { data: receipts } = await supabase
    .from("receipts")
    .select("storage_path")
    .eq("expense_id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung!.id);
  const paths = (receipts ?? []).map((receipt) => receipt.storage_path);
  if (paths.length) await supabase.storage.from("receipts").remove(paths);
  await supabase.from("receipts").delete().eq("expense_id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("expenses").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("depreciations").delete().eq("linked_expense_id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("reimbursements").delete().eq("source_expense_id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  revalidatePath("/ausgaben");
  revalidatePath("/abschreibungen");
}

export async function upsertBankFee(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { reportingCurrency } = getReportingContext(settings);

  const parsed = bankFeeSchema.safeParse({
    fee_date: formData.get("fee_date"),
    original_amount: formData.get("original_amount"),
    currency: formData.get("currency"),
    fee_type: formData.get("fee_type"),
    description: formData.get("description") || null,
    exchange_rate: formData.get("exchange_rate"),
    exchange_rate_manual: toBoolean(formData.get("exchange_rate_manual")),
    related_income_id: formData.get("related_income_id") || null
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "UngÃ¼ltige GebÃ¼hr." };
  }

  const values = parsed.data;
  const amountReporting = convertToReportingCurrency(
    values.original_amount,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const id = String(formData.get("id") ?? "");
  const exchangeRateSource = values.exchange_rate_manual ? "manuell" : "Frankfurter / ECB";

  const { error } = id
    ? await supabase
        .from("bank_fees")
        .update({
          user_id: user.id,
          buchhaltung_id: activeBuchhaltung!.id,
          fee_date: values.fee_date,
          original_amount: values.original_amount,
          currency: values.currency,
          fee_type: values.fee_type,
          description: values.description,
          exchange_rate: values.exchange_rate,
          exchange_rate_source: exchangeRateSource,
          exchange_rate_manual: values.exchange_rate_manual,
          reporting_currency: reportingCurrency,
          amount_reporting: amountReporting,
          related_income_id: values.related_income_id
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id)
    : await supabase.from("bank_fees").insert({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        fee_date: values.fee_date,
        original_amount: values.original_amount,
        currency: values.currency,
        fee_type: values.fee_type,
        description: values.description,
        exchange_rate: values.exchange_rate,
        exchange_rate_source: exchangeRateSource,
        exchange_rate_manual: values.exchange_rate_manual,
        reporting_currency: reportingCurrency,
        amount_reporting: amountReporting,
        related_income_id: values.related_income_id
      });

  if (error) {
    console.error("upsertBankFee error:", error);
    return { error: "GebÃ¼hr konnte nicht gespeichert werden." };
  }

  revalidatePath("/bank-gebuehren");
  revalidatePath("/dashboard");
  return { success: "GebÃ¼hr erfolgreich gespeichert." };
}

export async function deleteBankFee(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");
  await supabase.from("bank_fees").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  revalidatePath("/bank-gebuehren");
}

export async function upsertDepreciation(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { reportingCurrency } = getReportingContext(settings);

  const parsed = depreciationSchema.safeParse({
    description: formData.get("description"),
    original_amount: formData.get("original_amount"),
    currency: formData.get("currency"),
    exchange_rate: formData.get("exchange_rate"),
    exchange_rate_manual: toBoolean(formData.get("exchange_rate_manual")),
    acquisition_date: formData.get("acquisition_date"),
    useful_life_years: formData.get("useful_life_years"),
    note: formData.get("note") || null,
    linked_expense_id: formData.get("linked_expense_id") || null
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Abschreibung konnte nicht validiert werden." };
  }

  const values = parsed.data;
  const amountReporting = convertToReportingCurrency(
    values.original_amount,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const acquisitionYear = new Date(values.acquisition_date).getFullYear();
  const currentYear = new Date().getFullYear();
  const summary = calculateDepreciationSummary(
    amountReporting,
    values.useful_life_years,
    acquisitionYear,
    currentYear
  );
  const id = String(formData.get("id") ?? "");
  const exchangeRateSource = values.exchange_rate_manual ? "manuell" : "Frankfurter / ECB";

  const payload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung!.id,
    linked_expense_id: values.linked_expense_id,
    description: values.description,
    original_amount: values.original_amount,
    currency: values.currency,
    exchange_rate: values.exchange_rate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: values.exchange_rate_manual,
    reporting_currency: reportingCurrency,
    amount_reporting: amountReporting,
    acquisition_date: values.acquisition_date,
    useful_life_years: values.useful_life_years,
    yearly_amount_reporting: summary.yearlyAmountReporting,
    deducted_until_year_reporting: summary.deductedUntilYearReporting,
    remaining_value_reporting: summary.remainingValueReporting,
    remaining_years: summary.remainingYears,
    method: "linear",
    note: values.note
  };

  const { error } = id
    ? await supabase.from("depreciations").update(payload).eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id)
    : await supabase.from("depreciations").insert(payload);

  if (error) {
    console.error("upsertDepreciation error:", error);
    return { error: "Abschreibung konnte nicht gespeichert werden." };
  }

  revalidatePath("/abschreibungen");
  revalidatePath("/dashboard");
  return { success: "Abschreibung erfolgreich gespeichert." };
}

export async function deleteDepreciation(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");
  await supabase.from("depreciations").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  revalidatePath("/abschreibungen");
}

export async function upsertReimbursement(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { reportingCurrency } = getReportingContext(settings);

  const parsed = reimbursementSchema.safeParse({
    reimbursement_date: formData.get("reimbursement_date"),
    description: formData.get("description"),
    original_amount: formData.get("original_amount"),
    currency: formData.get("currency"),
    tax_mode: formData.get("tax_mode"),
    exchange_rate: formData.get("exchange_rate"),
    exchange_rate_manual: toBoolean(formData.get("exchange_rate_manual")),
    context_type: formData.get("context_type"),
    linked_record_id: formData.get("linked_record_id") || null,
    status: formData.get("status"),
    note: formData.get("note") || null,
    source_expense_id: formData.get("source_expense_id") || null,
    source_trip_id: formData.get("source_trip_id") || null
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Zuschuss konnte nicht gespeichert werden." };
  }

  const values = parsed.data;
  const amountReporting = convertToReportingCurrency(
    values.original_amount,
    values.currency,
    reportingCurrency,
    values.exchange_rate
  );
  const id = String(formData.get("id") ?? "");
  const exchangeRateSource = values.exchange_rate_manual ? "manuell" : "Frankfurter / ECB";

  const payload = {
    user_id: user.id,
    reimbursement_date: values.reimbursement_date,
    description: values.description,
    original_amount: values.original_amount,
    currency: values.currency,
    tax_mode: values.tax_mode,
    exchange_rate: values.exchange_rate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_manual: values.exchange_rate_manual,
    reporting_currency: reportingCurrency,
    amount_reporting: amountReporting,
    context_type: values.context_type,
    linked_record_id: values.linked_record_id,
    status: values.status,
    note: values.note,
    source_expense_id: values.source_expense_id,
    source_trip_id: values.source_trip_id
  };

  const { error } = id
    ? await supabase.from("reimbursements").update(payload).eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id)
    : await supabase.from("reimbursements").insert(payload);

  if (error) {
    console.error("upsertReimbursement error:", error);
    return { error: "Zuschuss konnte nicht gespeichert werden." };
  }

  revalidatePath("/zuschuesse");
  revalidatePath("/dashboard");
  return { success: "Zuschuss erfolgreich gespeichert." };
}

export async function deleteReimbursement(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");
  await supabase.from("reimbursements").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  revalidatePath("/zuschuesse");
}

export async function saveSettings(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung } = await getActionContext(false);
  const parsed = settingsSchema.safeParse({
    business_owner_name: formData.get("business_owner_name") || null,
    business_year: formData.get("business_year"),
    business_country: formData.get("business_country"),
    reporting_currency: formData.get("reporting_currency"),
    theme_mode: formData.get("theme_mode"),
    default_home_address: formData.get("default_home_address"),
    default_currency: formData.get("default_currency"),
    default_manual_chf_eur_rate: formData.get("default_manual_chf_eur_rate"),
    kleinunternehmer_mode: toBoolean(formData.get("kleinunternehmer_mode")),
    default_tax_mode: formData.get("default_tax_mode"),
    steuerberater_view: toBoolean(formData.get("steuerberater_view"))
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Einstellungen sind unvollstÃ¤ndig." };
  }

  const payload = {
    ...parsed.data,
    user_id: user.id
  };
  const { error } = await supabase.from("settings").upsert(payload, { onConflict: "user_id" });
  if (error) {
    console.error("saveSettings error:", error);
    return { error: "Einstellungen konnten nicht gespeichert werden." };
  }

  if (activeBuchhaltung) {
    const { error: buchhaltungError } = await supabase
      .from("buchhaltungen")
      .update({
        country: parsed.data.business_country,
        reporting_currency: parsed.data.reporting_currency
      })
      .eq("id", activeBuchhaltung.id)
      .eq("user_id", user.id);

    if (buchhaltungError) {
      console.error("saveBuchhaltungSettings error:", buchhaltungError);
      return { error: "Buchhaltung konnte nicht aktualisiert werden." };
    }
  }

  revalidatePath("/einstellungen");
  revalidatePath("/dashboard");
  return { success: "Einstellungen erfolgreich gespeichert." };
}

export async function saveEstimatedTaxRate(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const estimatedTaxRate = toNumber(formData.get("estimated_tax_rate"), 0);

  if (estimatedTaxRate < 0 || estimatedTaxRate > 100) {
    return { error: "Der Steuersatz muss zwischen 0 und 100 liegen." };
  }

  const { error } = await supabase
    .from("settings")
    .update({ estimated_tax_rate: estimatedTaxRate })
    .eq("user_id", user.id);

  if (error) {
    console.error("saveEstimatedTaxRate error:", error);
    return { error: "Der Steuersatz konnte nicht gespeichert werden." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/einstellungen");
  return { success: "Steuersatz erfolgreich gespeichert." };
}

export async function selectBuchhaltung(formData: FormData) {
  const id = String(formData.get("buchhaltung_id") ?? "");
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("buchhaltungen")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.id) {
    cookies().set(selectedBuchhaltungCookie, data.id, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365
    });
  }

  revalidatePath("/", "layout");
}

export async function closeBuchhaltung(formData: FormData): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung } = await getActionContext(false);
  if (!activeBuchhaltung) return { error: "Bitte zuerst eine Buchhaltung anlegen." };
  const endDate = String(formData.get("end_date") ?? "");
  if (!endDate) return { error: "Bitte ein Enddatum angeben." };

  const { error } = await supabase
    .from("buchhaltungen")
    .update({ status: "abgeschlossen", end_date: endDate })
    .eq("id", activeBuchhaltung.id)
    .eq("user_id", user.id);

  if (error) return { error: "Buchhaltung konnte nicht abgeschlossen werden." };
  revalidatePath("/", "layout");
  return { success: "Buchhaltung wurde abgeschlossen." };
}

export async function reopenBuchhaltung(): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung } = await getActionContext(false);
  if (!activeBuchhaltung) return { error: "Bitte zuerst eine Buchhaltung anlegen." };

  const { error } = await supabase
    .from("buchhaltungen")
    .update({ status: "aktiv", end_date: null })
    .eq("id", activeBuchhaltung.id)
    .eq("user_id", user.id);

  if (error) return { error: "Buchhaltung konnte nicht wieder geoeffnet werden." };
  revalidatePath("/", "layout");
  return { success: "Buchhaltung wurde wieder geoeffnet." };
}

export async function createBuchhaltung(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const country = String(formData.get("country") ?? "Deutschland") as BusinessCountry;
  const reportingCurrency = String(
    formData.get("reporting_currency") ?? getReportingCurrency(country)
  ) as ReportingCurrency;
  const name = String(formData.get("name") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "");

  if (!name || !startDate) return { error: "Name und Startdatum sind erforderlich." };

  const { data, error } = await supabase
    .from("buchhaltungen")
    .insert({
      user_id: user.id,
      name,
      country,
      reporting_currency: reportingCurrency,
      start_date: startDate,
      status: "aktiv"
    })
    .select("id")
    .single();

  if (error || !data?.id) return { error: "Buchhaltung konnte nicht angelegt werden." };
  cookies().set(selectedBuchhaltungCookie, data.id, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365
  });
  revalidatePath("/", "layout");
  return { success: "Buchhaltung wurde angelegt." };
}

export async function getReceiptViewUrl(formData: FormData): Promise<ActionResult & { url?: string }> {
  const { supabase, user, activeBuchhaltung } = await getActionContext(false);
  const receiptId = String(formData.get("receipt_id") ?? "");
  if (!activeBuchhaltung) return { error: "Keine Buchhaltung ausgewÃ¤hlt." };

  const { data: receipt } = await supabase
    .from("receipts")
    .select("storage_path")
    .eq("id", receiptId)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .maybeSingle();

  if (!receipt?.storage_path) return { error: "Beleg wurde nicht gefunden." };

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(receipt.storage_path, 60 * 5);

  if (error || !data?.signedUrl) return { error: "Beleg konnte nicht geÃ¶ffnet werden." };
  return { url: data.signedUrl };
}

export async function lookupExchangeRate(date: string, fallbackRate: number) {
  if (!date) {
    return {
      rate: fallbackRate,
      manualRequired: true,
      source: "manuell",
      warning: "Bitte zuerst ein Zahlungsdatum angeben."
    };
  }

  const result = await fetchHistoricalChfEurRate(date);
  if (result.manualRequired && fallbackRate > 0) {
    return { ...result, rate: fallbackRate };
  }
  return result;
}

async function deleteForCurrentUser(
  table: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  buchhaltungId?: string
) {
  let query = supabase.from(table).delete().eq("user_id", userId);
  if (buchhaltungId) query = query.eq("buchhaltung_id", buchhaltungId);
  const { error } = await query;
  if (error) throw error;
}

async function removeReceiptFilesForUser(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  buchhaltungId?: string
) {
  let query = supabase.from("receipts").select("storage_path").eq("user_id", userId);
  if (buchhaltungId) query = query.eq("buchhaltung_id", buchhaltungId);
  const { data } = await query;
  const paths = (data ?? []).map((receipt) => receipt.storage_path);
  if (paths.length) await supabase.storage.from("receipts").remove(paths);
}

export async function resetCurrentBuchhaltungData(): Promise<ActionResult> {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const buchhaltungId = activeBuchhaltung!.id;

  try {
    await removeReceiptFilesForUser(supabase, user.id, buchhaltungId);
    await deleteForCurrentUser("trip_segments", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("trip_stops", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("receipts", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("depreciations", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("bank_fees", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("reimbursements", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("trips", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("expenses", user.id, supabase, buchhaltungId);
    await deleteForCurrentUser("incomes", user.id, supabase, buchhaltungId);

    revalidatePath("/", "layout");
    return { success: "Daten der aktuellen Buchhaltung wurden gelÃ¶scht." };
  } catch (error) {
    console.error("resetCurrentBuchhaltungData error:", error);
    return { error: "Beim LÃ¶schen der aktuellen Buchhaltung ist ein Fehler aufgetreten." };
  }
}

export async function resetAllUserData(): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  try {
    await removeReceiptFilesForUser(supabase, user.id);
    await deleteForCurrentUser("trip_segments", user.id, supabase);
    await deleteForCurrentUser("trip_stops", user.id, supabase);
    await deleteForCurrentUser("receipts", user.id, supabase);
    await deleteForCurrentUser("depreciations", user.id, supabase);
    await deleteForCurrentUser("bank_fees", user.id, supabase);
    await deleteForCurrentUser("reimbursements", user.id, supabase);
    await deleteForCurrentUser("trips", user.id, supabase);
    await deleteForCurrentUser("expenses", user.id, supabase);
    await deleteForCurrentUser("incomes", user.id, supabase);
    await deleteForCurrentUser("exchange_rates", user.id, supabase);
    await deleteForCurrentUser("buchhaltungen", user.id, supabase);

    const resetSettings = {
      user_id: user.id,
      business_owner_name: null,
      business_year: new Date().getFullYear(),
      business_country: "Deutschland" as const,
      reporting_currency: "EUR" as const,
      theme_mode: "system" as const,
      default_home_address: "Ottobrunn, MÃ¼nchen, Deutschland",
      default_currency: "EUR" as const,
      default_manual_chf_eur_rate: 1,
      kleinunternehmer_mode: true,
      default_tax_mode: "BRUTTO" as const,
      estimated_tax_rate: 0,
      steuerberater_view: false
    };

    const { error: settingsError } = await supabase
      .from("settings")
      .upsert(resetSettings, { onConflict: "user_id" });

    if (settingsError) {
      throw settingsError;
    }

    [
      "/dashboard",
      "/einnahmen",
      "/ausgaben",
      "/bank-gebuehren",
      "/fahrten-reisen",
      "/abschreibungen",
      "/zuschuesse",
      "/einstellungen"
    ].forEach((path) => revalidatePath(path));

    cookies().delete(selectedBuchhaltungCookie);
    return { success: "Alle Daten wurden geloescht" };
  } catch (error) {
    console.error("resetAllUserData error:", error);
    return { error: "Beim Loeschen der Daten ist ein Fehler aufgetreten." };
  }
}

export async function createTrip(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { businessCountry, reportingCurrency } = getReportingContext(settings);

  const rawStops = String(formData.get("stops_json") ?? "[]");
  const rawSegments = String(formData.get("segments_json") ?? "[]");
  const startAt = String(formData.get("start_at") ?? "");
  const endAt = String(formData.get("end_at") ?? "");
  const startPoint = String(formData.get("start_point") ?? "");
  const endPoint = String(formData.get("end_point") ?? "");
  const title = String(formData.get("title") ?? "");
  const businessReason = String(formData.get("business_reason") ?? "");
  const note = String(formData.get("note") ?? "");
  const reimbursableToClient = toBoolean(formData.get("reimbursable_to_client"));
  const reimbursementAmountOriginal = toNumber(formData.get("reimbursement_amount_original"), 0);
  const reimbursementCurrency = (String(formData.get("reimbursement_currency") ?? reportingCurrency) ||
    reportingCurrency) as CurrencyCode;
  const exchangeRate = toNumber(formData.get("reimbursement_exchange_rate"), 1);
  const exchangeRateManual = toBoolean(formData.get("reimbursement_exchange_rate_manual"));
  const exchangeRateSource = exchangeRateManual ? "manuell" : "Frankfurter / ECB";

  let stops: Array<Record<string, unknown>> = [];
  let segments: Array<Record<string, unknown>> = [];
  try {
    stops = JSON.parse(rawStops);
    segments = JSON.parse(rawSegments);
  } catch {
    return { error: "Stopps oder Fahrsegmente konnten nicht gelesen werden." };
  }

  const chronologyErrors = validateTripChronology(startAt, endAt, stops as never[]);
  if (chronologyErrors.length > 0) {
    return { error: chronologyErrors[0] };
  }

  const totals = calculateTripTotals(
    segments.map((segment) => ({
      id: String(segment.id ?? ""),
      from_label: String(segment.from_label ?? ""),
      to_label: String(segment.to_label ?? ""),
      kilometers: toNumber(String(segment.kilometers ?? "0")),
      is_business: segment.is_business !== false
    }))
  );
  const perDiem = buildPerDiemBreakdown({
    startAt,
    endAt,
    stops: stops as never[],
    businessCountry
  });
  const mixedTrip = (stops as Array<Record<string, unknown>>).some((stop) => stop.purpose === "Privat");

  const { data: tripData, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung!.id,
      title,
      business_reason: businessReason || title,
      start_point: startPoint,
      start_at: startAt,
      end_point: endPoint,
      end_at: endAt,
      note: note || null,
      total_km: totals.totalKm,
      reporting_currency: reportingCurrency,
      driving_deduction_reporting: totals.drivingDeduction,
      total_travel_expenses_reporting: 0,
      total_per_diem_reporting: perDiem.total,
      deductible_total_reporting: roundMoney(totals.drivingDeduction + perDiem.total),
      mixed_trip_warning: mixedTrip
        ? "Mindestens ein privater Stopp vorhanden. Bitte steuerliche Trennung prÃ¼fen."
        : null,
      per_diem_breakdown: perDiem.breakdown,
      reimbursable_to_client: reimbursableToClient,
      reimbursement_id: null
    })
    .select("id")
    .single();

  if (error || !tripData) {
    console.error("createTrip error:", error);
    return { error: "Reise konnte nicht gespeichert werden." };
  }

  if (stops.length) {
    await supabase.from("trip_stops").insert(
      stops.map((stop, index) => ({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        trip_id: tripData.id,
        sort_order: index + 1,
        location: String(stop.location ?? ""),
        country: String(stop.country ?? ""),
        arrival_at: String(stop.arrival_at ?? ""),
        departure_at: String(stop.departure_at ?? ""),
        purpose: String(stop.purpose ?? "GeschÃ¤ftlich"),
        breakfast_provided: Boolean(stop.breakfast_provided),
        lunch_provided: Boolean(stop.lunch_provided),
        dinner_provided: Boolean(stop.dinner_provided),
        note: stop.note ? String(stop.note) : null
      }))
    );
  }

  if (segments.length) {
    await supabase.from("trip_segments").insert(
      segments.map((segment, index) => {
        const kilometers = toNumber(String(segment.kilometers ?? "0"), 0);
        return {
          user_id: user.id,
          buchhaltung_id: activeBuchhaltung!.id,
          trip_id: tripData.id,
          sort_order: index + 1,
          from_label: String(segment.from_label ?? ""),
          to_label: String(segment.to_label ?? ""),
          kilometers,
          is_business: segment.is_business !== false,
          deduction_reporting: roundMoney(kilometers * 0.3),
          note: segment.note ? String(segment.note) : null
        };
      })
    );
  }

  if (reimbursableToClient && reimbursementAmountOriginal > 0) {
    const amountReporting = convertToReportingCurrency(
      reimbursementAmountOriginal,
      reimbursementCurrency,
      reportingCurrency,
      exchangeRate
    );
    const { data: reimbursement } = await supabase
      .from("reimbursements")
      .insert({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        reimbursement_date: startAt.slice(0, 10),
        description: `Weiterberechenbare Reisekosten: ${title}`,
        original_amount: reimbursementAmountOriginal,
        currency: reimbursementCurrency,
        tax_mode: "BRUTTO",
        exchange_rate: exchangeRate,
        exchange_rate_source: exchangeRateSource,
        exchange_rate_manual: exchangeRateManual,
        reporting_currency: reportingCurrency,
        amount_reporting: amountReporting,
        context_type: "Reise",
        linked_record_id: tripData.id,
        status: "offen",
        note: null,
        source_expense_id: null,
        source_trip_id: tripData.id
      })
      .select("id")
      .single();

    if (reimbursement?.id) {
      await supabase
        .from("trips")
        .update({ reimbursement_id: reimbursement.id })
        .eq("id", tripData.id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id);
    }
  }

  revalidatePath("/fahrten-reisen");
  revalidatePath("/dashboard");
  revalidatePath("/zuschuesse");
  return { success: "Reise erfolgreich gespeichert." };
}

export async function upsertTrip(formData: FormData): Promise<ActionResult> {
  const { supabase, user, settings, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return { error: writeError };
  const { businessCountry, reportingCurrency } = getReportingContext(settings);

  const rawStops = String(formData.get("stops_json") ?? "[]");
  const rawSegments = String(formData.get("segments_json") ?? "[]");
  const startAt = String(formData.get("start_at") ?? "");
  const endAt = String(formData.get("end_at") ?? "");
  const startPoint = String(formData.get("start_point") ?? "");
  const endPoint = String(formData.get("end_point") ?? "");
  const title = String(formData.get("title") ?? "");
  const businessReason = String(formData.get("business_reason") ?? "");
  const note = String(formData.get("note") ?? "");
  const tripId = String(formData.get("id") ?? "");
  const reimbursableToClient = toBoolean(formData.get("reimbursable_to_client"));
  const reimbursementAmountOriginal = toNumber(formData.get("reimbursement_amount_original"), 0);
  const reimbursementCurrency = (String(formData.get("reimbursement_currency") ?? reportingCurrency) ||
    reportingCurrency) as CurrencyCode;
  const exchangeRate = toNumber(formData.get("reimbursement_exchange_rate"), 1);
  const exchangeRateManual = toBoolean(formData.get("reimbursement_exchange_rate_manual"));
  const exchangeRateSource = exchangeRateManual ? "manuell" : "Frankfurter / ECB";

  let stops: Array<Record<string, unknown>> = [];
  let segments: Array<Record<string, unknown>> = [];
  try {
    stops = JSON.parse(rawStops);
    segments = JSON.parse(rawSegments);
  } catch {
    return { error: "Stopps oder Fahrsegmente konnten nicht gelesen werden." };
  }

  const chronologyErrors = validateTripChronology(startAt, endAt, stops as never[]);
  if (chronologyErrors.length > 0) {
    return { error: chronologyErrors[0] };
  }

  const totals = calculateTripTotals(
    segments.map((segment) => ({
      id: String(segment.id ?? ""),
      from_label: String(segment.from_label ?? ""),
      to_label: String(segment.to_label ?? ""),
      kilometers: toNumber(String(segment.kilometers ?? "0")),
      is_business: segment.is_business !== false
    }))
  );
  const perDiem = buildPerDiemBreakdown({
    startAt,
    endAt,
    stops: stops as never[],
    businessCountry
  });
  const mixedTrip = (stops as Array<Record<string, unknown>>).some((stop) => stop.purpose === "Privat");

  const tripPayload = {
    user_id: user.id,
    buchhaltung_id: activeBuchhaltung!.id,
    title,
    business_reason: businessReason || title,
    start_point: startPoint,
    start_at: startAt,
    end_point: endPoint,
    end_at: endAt,
    note: note || null,
    total_km: totals.totalKm,
    reporting_currency: reportingCurrency,
    driving_deduction_reporting: totals.drivingDeduction,
    total_travel_expenses_reporting: 0,
    total_per_diem_reporting: perDiem.total,
    deductible_total_reporting: roundMoney(totals.drivingDeduction + perDiem.total),
    mixed_trip_warning: mixedTrip
      ? "Mindestens ein privater Stopp vorhanden. Bitte steuerliche Trennung prÃ¼fen."
      : null,
    per_diem_breakdown: perDiem.breakdown,
    reimbursable_to_client: reimbursableToClient
  };

  const { data: tripData, error } = tripId
    ? await supabase
        .from("trips")
        .update(tripPayload)
        .eq("id", tripId)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id)
        .select("id, reimbursement_id")
        .single()
    : await supabase
        .from("trips")
        .insert({
          ...tripPayload,
          reimbursement_id: null
        })
        .select("id, reimbursement_id")
        .single();

  if (error || !tripData) {
    console.error("upsertTrip error:", error);
    return { error: "Reise konnte nicht gespeichert werden." };
  }

  await supabase.from("trip_stops").delete().eq("trip_id", tripData.id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("trip_segments").delete().eq("trip_id", tripData.id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);

  if (stops.length) {
    await supabase.from("trip_stops").insert(
      stops.map((stop, index) => ({
        user_id: user.id,
        buchhaltung_id: activeBuchhaltung!.id,
        trip_id: tripData.id,
        sort_order: index + 1,
        location: String(stop.location ?? ""),
        country: String(stop.country ?? ""),
        arrival_at: String(stop.arrival_at ?? ""),
        departure_at: String(stop.departure_at ?? ""),
        purpose: String(stop.purpose ?? "GeschÃ¤ftlich"),
        breakfast_provided: Boolean(stop.breakfast_provided),
        lunch_provided: Boolean(stop.lunch_provided),
        dinner_provided: Boolean(stop.dinner_provided),
        note: stop.note ? String(stop.note) : null
      }))
    );
  }

  if (segments.length) {
    await supabase.from("trip_segments").insert(
      segments.map((segment, index) => {
        const kilometers = toNumber(String(segment.kilometers ?? "0"), 0);
        return {
          user_id: user.id,
          buchhaltung_id: activeBuchhaltung!.id,
          trip_id: tripData.id,
          sort_order: index + 1,
          from_label: String(segment.from_label ?? ""),
          to_label: String(segment.to_label ?? ""),
          kilometers,
          is_business: segment.is_business !== false,
          deduction_reporting: roundMoney(kilometers * 0.3),
          note: segment.note ? String(segment.note) : null
        };
      })
    );
  }

  if (reimbursableToClient && reimbursementAmountOriginal > 0) {
    const amountReporting = convertToReportingCurrency(
      reimbursementAmountOriginal,
      reimbursementCurrency,
      reportingCurrency,
      exchangeRate
    );
    const reimbursementPayload = {
      user_id: user.id,
      buchhaltung_id: activeBuchhaltung!.id,
      reimbursement_date: startAt.slice(0, 10),
      description: `Weiterberechenbare Reisekosten: ${title}`,
      original_amount: reimbursementAmountOriginal,
      currency: reimbursementCurrency,
      tax_mode: "BRUTTO",
      exchange_rate: exchangeRate,
      exchange_rate_source: exchangeRateSource,
      exchange_rate_manual: exchangeRateManual,
      reporting_currency: reportingCurrency,
      amount_reporting: amountReporting,
      context_type: "Reise",
      linked_record_id: tripData.id,
      status: "offen",
      note: null,
      source_expense_id: null,
      source_trip_id: tripData.id
    };
    const { data: reimbursement } = tripData.reimbursement_id
      ? await supabase
          .from("reimbursements")
          .update(reimbursementPayload)
          .eq("id", tripData.reimbursement_id)
          .eq("user_id", user.id)
          .eq("buchhaltung_id", activeBuchhaltung!.id)
          .select("id")
          .single()
      : await supabase
          .from("reimbursements")
          .insert(reimbursementPayload)
          .select("id")
          .single();

    if (reimbursement?.id) {
      await supabase
        .from("trips")
        .update({ reimbursement_id: reimbursement.id })
        .eq("id", tripData.id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung!.id);
    }
  } else {
    await removeTripReimbursement(supabase, user.id, tripData.id);
  }

  revalidatePath("/fahrten-reisen");
  revalidatePath("/dashboard");
  revalidatePath("/zuschuesse");
  return { success: tripId ? "Reise erfolgreich aktualisiert." : "Reise erfolgreich gespeichert." };
}

export async function deleteTrip(formData: FormData) {
  const { supabase, user, activeBuchhaltung, writeError } = await getActionContext(true);
  if (writeError) return;
  const id = String(formData.get("id") ?? "");

  await removeTripReimbursement(supabase, user.id, id);
  await supabase.from("trip_segments").delete().eq("trip_id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("trip_stops").delete().eq("trip_id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);
  await supabase.from("trips").delete().eq("id", id).eq("user_id", user.id).eq("buchhaltung_id", activeBuchhaltung!.id);

  revalidatePath("/fahrten-reisen");
  revalidatePath("/dashboard");
  revalidatePath("/zuschuesse");
}
