import { cache } from "react";
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

  const [incomes, expenses, fees, trips, depreciations, reimbursements, invoices] =
    await Promise.all([
    selected.has("incomes") ? supabase
      .from("incomes")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date", { ascending: false }) : emptyResult(),
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
    selected.has("invoices") ? supabase
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeId)
      .gte("issue_date", from)
      .lte("issue_date", to) : emptyResult()
  ]);

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
    invoices: safeArray(invoices.data)
  };
}

export async function getDashboardData(year?: number) {
  const data = await getModuleData(year);
  const reportingCurrency = data.settings?.reporting_currency ?? "EUR";

  const incomeTotal = data.incomes.reduce((sum, row) => sum + (row.invoice_amount_reporting ?? 0), 0);
  const paymentReceivedTotal = data.incomes.reduce(
    (sum, row) => sum + (row.payment_received_reporting ?? 0),
    0
  );
  const openIncomeTotal = data.incomes
    .filter((row) => !isIncomePaid(row.status))
    .reduce((sum, row) => sum + (row.difference_reporting ?? row.invoice_amount_reporting ?? 0), 0);

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
  const feeTotal = data.fees.reduce((sum, row) => sum + (row.amount_reporting ?? 0), 0);
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
  const openInvoices = data.invoices.filter((invoice) =>
    ["Ausgestellt", "Versendet", "Teilweise bezahlt"].includes(invoice.status)
  );
  const overdueInvoices = openInvoices.filter(
    (invoice) =>
      invoice.due_date < today &&
      (invoice.gross_total_cents ?? 0) > (invoice.paid_total_cents ?? 0)
  );
  const openInvoiceAmount = openInvoices.reduce(
    (sum, invoice) =>
      sum + Math.max((invoice.gross_total_cents ?? 0) - (invoice.paid_total_cents ?? 0), 0) / 100,
    0
  );
  const currentMonth = today.slice(0, 7);
  const invoicesIssuedThisMonth = data.invoices.filter((invoice) =>
    String(invoice.issue_date).startsWith(currentMonth)
  ).length;
  const invoicesPaidThisMonth = data.invoices.filter(
    (invoice) => invoice.status === "Bezahlt" && String(invoice.updated_at).startsWith(currentMonth)
  ).length;
  const deductibleCostTotal =
    deductibleExpensesTotal + feeTotal + tripDrivingTotal + tripTravelTotal + depreciationTotal;
  const profitBeforeDeductions = paymentReceivedTotal - effectiveExpensesTotal - feeTotal;
  const taxRelevantProfit = paymentReceivedTotal - deductibleCostTotal;

  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const incomes = data.incomes
      .filter((row) => new Date(row.invoice_date).getMonth() + 1 === month)
      .reduce((sum, row) => sum + (row.payment_received_reporting ?? 0), 0);
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
        .filter((row) => new Date(row.fee_date).getMonth() + 1 === month)
        .reduce((sum, row) => sum + (row.amount_reporting ?? 0), 0) +
      data.trips
        .filter((row) => new Date(row.start_at).getMonth() + 1 === month)
        .reduce((sum, row) => sum + (row.total_per_diem_reporting ?? 0), 0) +
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
