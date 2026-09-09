import { cache } from "react";
import { readLedgerPages, readScopedPayments } from "@/lib/ledger-query";
import { reconcileInvoice, receivedIncomeAmount } from "@/lib/invoice-accounting";
import type { Invoice, CurrencyCode } from "@/lib/db-types";
import { requireUser } from "@/lib/auth";
import { basePerDiemRates } from "@/lib/per-diem";
import {
  calculateDepreciationSummary,
  isDepreciationActiveInYear
} from "@/lib/depreciation";
import { isIncomePaid, normalizeIncomeStatus } from "@/lib/income-status";
import { calculateTripTotals } from "@/lib/trips";
import { getYearEnd, getYearStart, safeArray } from "@/lib/utils";
import {
  applyBuchhaltungSettings,
  getSelectedBuchhaltung
} from "@/lib/buchhaltungen";
import type { MileageYearSetting, TripTemplate } from "@/lib/db-types";

export type ModuleDataset =
  | "incomes"
  | "expenses"
  | "fees"
  | "trips"
  | "depreciations"
  | "reimbursements"
  | "invoices";

const allModuleDatasets: ModuleDataset[] = [
  "incomes",
  "expenses",
  "fees",
  "trips",
  "depreciations",
  "reimbursements",
  "invoices"
];

export const getAccountingContext = cache(async () => {
  const { supabase, user } = await requireUser();
  const { data: rawSettings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const { buchhaltungen, activeBuchhaltung } = await getSelectedBuchhaltung(
    supabase,
    user,
    rawSettings
  );

  return {
    supabase,
    user,
    rawSettings,
    settings: applyBuchhaltungSettings(rawSettings, activeBuchhaltung),
    buchhaltungen,
    activeBuchhaltung
  };
});

export async function getSettings() {
  const { settings } = await getAccountingContext();
  return settings;
}

export async function getBuchhaltungContext() {
  const { buchhaltungen, activeBuchhaltung } = await getAccountingContext();
  return { buchhaltungen, activeBuchhaltung };
}

export const getMileageYearSettings = cache(async () => {
  const { supabase, user, activeBuchhaltung } = await getAccountingContext();
  if (!activeBuchhaltung) return [] as MileageYearSetting[];

  const { data, error } = await supabase
    .from("buchhaltung_year_settings")
    .select("*")
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .order("year", { ascending: false });

  if (error) {
    console.error("getMileageYearSettings error:", error);
    return [] as MileageYearSetting[];
  }
  return (data ?? []) as MileageYearSetting[];
});

export const getTripTemplates = cache(async () => {
  const { supabase, user, activeBuchhaltung } = await getAccountingContext();
  if (!activeBuchhaltung) return [] as TripTemplate[];

  const { data, error } = await supabase
    .from("trip_templates")
    .select("*")
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .order("name", { ascending: true });

  if (error) {
    console.error("getTripTemplates error:", error);
    return [] as TripTemplate[];
  }
  return (data ?? []) as TripTemplate[];
});

export async function getModuleData(year?: number, datasets: ModuleDataset[] = allModuleDatasets) {
  const {
    supabase,
    user,
    settings,
    buchhaltungen,
    activeBuchhaltung
  } = await getAccountingContext();
  const businessYear = year ?? settings?.business_year ?? new Date().getFullYear();
  const from = getYearStart(businessYear);
  const to = getYearEnd(businessYear);
  const selected = new Set(datasets);
  const activeId = activeBuchhaltung?.id ?? "00000000-0000-0000-0000-000000000000";
  const emptyResult = () => Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [incomes, expenses, fees, trips, depreciations, reimbursements, invoices, invoicePayments] =
    await Promise.all([
    selected.has("incomes") ? readLedgerPages((start, end) => supabase
      .from("incomes")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .or(`and(invoice_date.gte.${from},invoice_date.lte.${to}),and(payment_date.gte.${from},payment_date.lte.${to})`)
      .order("invoice_date", { ascending: false }).order("id").range(start, end)).then((data) => ({ data })) : emptyResult(),
    selected.has("expenses") ? supabase
      .from("expenses")
      .select("*, receipts(*)")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false }) : emptyResult(),
    selected.has("fees") ? supabase
      .from("bank_fees")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("fee_date", from)
      .lte("fee_date", to)
      .order("fee_date", { ascending: false }) : emptyResult(),
    selected.has("trips") ? supabase
      .from("trips")
      .select("*, trip_stops(*), trip_segments(*)")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("start_at", `${from}T00:00:00`)
      .lte("start_at", `${to}T23:59:59`)
      .order("start_at", { ascending: false }) : emptyResult(),
    selected.has("depreciations") ? supabase
      .from("depreciations")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .lte("acquisition_date", to)
      .order("acquisition_date", { ascending: false }) : emptyResult(),
    selected.has("reimbursements") ? supabase
      .from("reimbursements")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("reimbursement_date", from)
      .lte("reimbursement_date", to)
      .order("reimbursement_date", { ascending: false }) : emptyResult(),
    selected.has("invoices") ? readLedgerPages((start, end) => supabase
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .lte("issue_date", to).order("id").range(start, end)).then((data) => ({ data })) : emptyResult(),
    selected.has("invoices") ? readScopedPayments(supabase, user.id, activeId) : Promise.resolve([])
  ]);

  for (const result of [incomes, expenses, fees, trips, depreciations, reimbursements, invoices]) {
    if ("error" in result && result.error) throw new Error("Buchhaltungsdaten konnten nicht vollständig geladen werden. Bitte erneut versuchen.");
  }

  return {
    businessYear,
    settings,
    buchhaltungen,
    activeBuchhaltung,
    incomes: safeArray(incomes.data).map((row) => ({
      ...row,
      status: normalizeIncomeStatus(row.status)
    })),
    expenses: safeArray(expenses.data),
    fees: safeArray(fees.data),
    trips: safeArray(trips.data),
    depreciations: safeArray(depreciations.data),
    reimbursements: safeArray(reimbursements.data),
    invoices: safeArray(invoices.data).map((row) => ({ ...row, payments: invoicePayments.filter((payment) => payment.invoice_id === row.id) }))
  };
}

export async function getDashboardData(year?: number) {
  const data = await getModuleData(year);
  const reportingCurrency = data.settings?.reporting_currency ?? "EUR";

  const incomeTotal = data.invoices.filter((row) => String(row.issue_date).startsWith(String(data.businessYear)) && row.currency === reportingCurrency && !["Entwurf", "Storniert"].includes(row.status)).reduce((sum, row) => sum + Number(row.gross_total_cents) / 100, 0)
    + data.incomes.filter((row) => !row.invoice_id && String(row.invoice_date).startsWith(String(data.businessYear)))
      .reduce((sum, row) => sum + Number(row.invoice_amount_reporting ?? 0), 0);
  const paymentReceivedTotal = data.incomes.reduce((sum, row) => sum + receivedIncomeAmount(row, data.businessYear), 0);
  const standaloneOpenIncomeTotal = data.incomes.filter((row) => !row.invoice_id && !isIncomePaid(row.status))
    .reduce((sum, row) => sum + Number(row.difference_reporting ?? row.invoice_amount_reporting ?? 0), 0);

  const expensesTotal = data.expenses.reduce((sum, row) => sum + (row.amount_reporting ?? 0), 0);
  const clientShareTotal = data.expenses.reduce(
    (sum, row) => sum + (row.client_share_amount_reporting ?? 0),
    0
  );
  const effectiveExpensesTotal = data.expenses.reduce(
    (sum, row) => sum + (row.effective_amount_reporting ?? row.amount_reporting ?? 0),
    0
  );
  const deductibleExpensesTotal = data.expenses.reduce(
    (sum, row) =>
      sum +
      (row.effective_deductible_amount_reporting ?? row.deductible_amount_reporting ?? 0),
    0
  );
  const unreimbursedCosts = data.expenses.reduce(
    (sum, row) => sum + (row.effective_amount_reporting ?? row.amount_reporting ?? 0),
    0
  );
  const feeTotal = data.fees.reduce((sum, row) => sum + Number(row.amount_reporting ?? 0), 0);
  // New payment deductions are already excluded from actual cash received.
  const deductibleFeeTotal = data.fees.filter((row) => !row.invoice_payment_id).reduce((sum, row) => sum + Number(row.amount_reporting ?? 0), 0);
  const tripDrivingTotal = data.trips.reduce(
    (sum, row) => sum + (row.driving_deduction_reporting ?? 0),
    0
  );
  const tripTravelTotal = data.trips.reduce(
    (sum, row) =>
      sum + (row.total_travel_expenses_reporting ?? 0) + (row.total_per_diem_reporting ?? 0),
    0
  );
  const depreciationTotal = data.depreciations
    .filter((row) =>
      isDepreciationActiveInYear(
        row.acquisition_date,
        Number(row.useful_life_years),
        data.businessYear
      )
    )
    .reduce((sum, row) => sum + (row.yearly_amount_reporting ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const invoiceStates = data.invoices.map((invoice) => ({ invoice: invoice as Invoice, state: reconcileInvoice(invoice as Invoice) }));
  const openInvoices = invoiceStates.filter(({ state }) => state.remainingCents > 0);
  const overdueInvoices = openInvoices.filter(({ invoice }) => invoice.due_date < today);
  const openInvoiceAmounts: Record<CurrencyCode, number> = { CHF: 0, EUR: 0 };
  for (const { invoice, state } of openInvoices) openInvoiceAmounts[invoice.currency as CurrencyCode] += state.remainingCents / 100;
  // Never sum EUR face values into CHF, or invent an exchange rate for receivables.
  const openInvoiceAmount = openInvoiceAmounts[reportingCurrency as CurrencyCode];
  const openIncomeTotal = standaloneOpenIncomeTotal + openInvoiceAmount;
  const currentMonth = today.slice(0, 7);
  const invoicesIssuedThisMonth = data.invoices.filter((invoice) =>
    String(invoice.issue_date).startsWith(currentMonth)
  ).length;
  const invoicesPaidThisMonth = invoiceStates.filter(({ invoice, state }) =>
    state.status === "Bezahlt" && (invoice.payments ?? []).reduce((latest, payment) =>
      payment.payment_date > latest ? payment.payment_date : latest, "").startsWith(currentMonth)
  ).length;
  const deductibleCostTotal =
    deductibleExpensesTotal + deductibleFeeTotal + tripDrivingTotal + tripTravelTotal + depreciationTotal;
  const profitBeforeDeductions = paymentReceivedTotal - effectiveExpensesTotal - deductibleFeeTotal;
  const taxRelevantProfit = paymentReceivedTotal - deductibleCostTotal;

  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const incomes = data.incomes
      .filter((row) => row.payment_date && new Date(row.payment_date).getMonth() + 1 === month)
      .reduce((sum, row) => sum + receivedIncomeAmount(row, data.businessYear), 0);
    const costs =
      data.expenses
        .filter((row) => new Date(row.expense_date).getMonth() + 1 === month)
        .reduce(
          (sum, row) =>
            sum +
            (row.effective_deductible_amount_reporting ?? row.deductible_amount_reporting ?? 0),
          0
        ) +
      data.fees
        .filter((row) => !row.invoice_payment_id)
        .filter((row) => new Date(row.fee_date).getMonth() + 1 === month)
        .reduce((sum, row) => sum + (row.amount_reporting ?? 0), 0) +
      data.trips
        .filter((row) => new Date(row.start_at).getMonth() + 1 === month)
        .reduce(
          (sum, row) =>
            sum +
            (row.driving_deduction_reporting ?? 0) +
            (row.total_travel_expenses_reporting ?? 0) +
            (row.total_per_diem_reporting ?? 0),
          0
        ) +
      data.depreciations
        .filter(
          (row) =>
            isDepreciationActiveInYear(
              row.acquisition_date,
              Number(row.useful_life_years),
              data.businessYear
            ) && new Date(row.acquisition_date).getMonth() + 1 === month
        )
        .reduce((sum, row) => sum + (row.yearly_amount_reporting ?? 0), 0);
    const clientShare = data.expenses
      .filter((row) => new Date(row.expense_date).getMonth() + 1 === month)
      .reduce((sum, row) => sum + (row.client_share_amount_reporting ?? 0), 0);

    return {
      month,
      incomes,
      costs,
      clientShare,
      result: incomes - costs
    };
  });

  return {
    ...data,
    reportingCurrency,
    kpis: {
      incomeTotal,
      paymentReceivedTotal,
      openIncomeTotal,
      expensesTotal,
      clientShareTotal,
      effectiveExpensesTotal,
      deductibleExpensesTotal,
      feeTotal,
      tripDrivingTotal,
      tripTravelTotal,
      depreciationTotal,
      deductibleCostTotal,
      profitBeforeDeductions,
      taxRelevantProfit,
      unreimbursedCosts,
      openInvoices: openInvoices.length,
      overdueInvoices: overdueInvoices.length,
      openInvoiceAmount,
      openInvoiceAmounts,
      deductibleFeeTotal,
      invoicesIssuedThisMonth,
      invoicesPaidThisMonth
    },
    monthly,
    rateReference: basePerDiemRates,
    helperSamples: {
      depreciation: calculateDepreciationSummary(1200, 3, data.businessYear, data.businessYear),
      trips: calculateTripTotals([
        { id: "1", from_label: "Start", to_label: "Stopp", kilometers: 120 },
        { id: "2", from_label: "Stopp", to_label: "Ende", kilometers: 120 }
      ])
    }
  };
}
