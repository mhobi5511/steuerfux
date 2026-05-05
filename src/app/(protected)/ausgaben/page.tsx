import { deleteExpense } from "@/app/actions/finance";
import { ExpenseForm } from "@/components/forms/expense-form";
import { PageHeader } from "@/components/layout/page-header";
import {
  MonthFilter,
  getSelectedMonth,
  matchesSelectedMonth
} from "@/components/records/month-filter";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function ExpensesPage({
  searchParams
}: {
  searchParams?: { month?: string };
}) {
  const { expenses, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const selectedMonth = getSelectedMonth(searchParams?.month);
  const filteredExpenses = expenses.filter((expense) =>
    matchesSelectedMonth(expense.payment_date || expense.expense_date, selectedMonth)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ausgaben"
        description={
          settings?.steuerberater_view
            ? "Erfasse Ausgaben mit Zahlungsdatum, Originalwährung, Abzugsfähigkeit, Belegstatus und optionaler Kundenbeteiligung."
            : null
        }
      />
      <ExpenseForm
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        reportingCurrency={reportingCurrency}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        defaultTaxMode={settings?.default_tax_mode ?? "BRUTTO"}
        businessCountry={settings?.business_country ?? "Deutschland"}
        showAdvisorDetails={Boolean(settings?.steuerberater_view)}
      />
      <MonthFilter action="/ausgaben" selectedMonth={selectedMonth} />
      <SimpleTable
        title="Gespeicherte Ausgaben"
        columns={["Zahlungsdatum", "Kategorie", "Beschreibung", "Originalbetrag", "Kundenbeteiligung", "Effektive Kosten", "Aktion"]}
        emptyText="Noch keine Ausgaben erfasst."
        rows={filteredExpenses.map((expense) => [
          formatDate(expense.payment_date || expense.expense_date),
          expense.category,
          expense.description,
          `${formatCurrency(expense.original_amount, expense.currency)} (${expense.tax_mode})`,
          expense.reimbursable_to_client
            ? expense.client_share_mode === "fixed"
              ? `${formatCurrency(expense.client_share_fixed_amount ?? expense.client_share_amount_original, expense.client_share_fixed_currency ?? expense.currency)} / ${formatCurrency(expense.client_share_amount_reporting, reportingCurrency)}`
              : `${expense.client_share_percentage}% / ${formatCurrency(expense.client_share_amount_reporting, reportingCurrency)}`
            : "Keine",
          `${formatCurrency(expense.effective_amount_reporting ?? expense.amount_reporting, reportingCurrency)} / absetzbar ${formatCurrency(expense.effective_deductible_amount_reporting ?? expense.deductible_amount_reporting, reportingCurrency)}`,
          <DeleteButton key={expense.id} id={expense.id} action={deleteExpense} />
        ])}
      />
    </div>
  );
}
