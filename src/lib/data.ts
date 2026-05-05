import { requireUser } from "@/lib/auth";
import { basePerDiemRates } from "@/lib/per-diem";
import { calculateDepreciationSummary } from "@/lib/depreciation";
import { isIncomePaid, normalizeIncomeStatus } from "@/lib/income-status";
import { calculateTripTotals } from "@/lib/trips";
import { getYearEnd, getYearStart, safeArray } from "@/lib/utils";

export async function getSettings() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("settings").select("*").maybeSingle();
  return data;
}

export async function getModuleData(year?: number) {
  const { supabase } = await requireUser();
  const settings = await getSettings();
  const businessYear = year ?? settings?.business_year ?? new Date().getFullYear();
  const from = getYearStart(businessYear);
  const to = getYearEnd(businessYear);

  const [incomes, expenses, fees, trips, depreciations, reimbursements] = await Promise.all([
    supabase
      .from("incomes")
      .select("*")
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("expenses")
      .select("*")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false }),
    supabase
      .from("bank_fees")
      .select("*")
      .gte("fee_date", from)
      .lte("fee_date", to)
      .order("fee_date", { ascending: false }),
    supabase
      .from("trips")
      .select("*, trip_stops(*), trip_segments(*)")
      .gte("start_at", `${from}T00:00:00`)
      .lte("start_at", `${to}T23:59:59`)
      .order("start_at", { ascending: false }),
    supabase
      .from("depreciations")
      .select("*")
      .gte("acquisition_date", from)
      .lte("acquisition_date", to)
      .order("acquisition_date", { ascending: false }),
    supabase
      .from("reimbursements")
      .select("*")
      .gte("reimbursement_date", from)
      .lte("reimbursement_date", to)
      .order("reimbursement_date", { ascending: false })
  ]);

  return {
    businessYear,
    settings,
    incomes: safeArray(incomes.data).map((row) => ({
      ...row,
      status: normalizeIncomeStatus(row.status)
    })),
    expenses: safeArray(expenses.data),
    fees: safeArray(fees.data),
    trips: safeArray(trips.data),
    depreciations: safeArray(depreciations.data),
    reimbursements: safeArray(reimbursements.data)
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
  const depreciationTotal = data.depreciations.reduce(
    (sum, row) => sum + (row.yearly_amount_reporting ?? 0),
    0
  );
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
        .filter((row) => new Date(row.acquisition_date).getMonth() + 1 === month)
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
      unreimbursedCosts
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
