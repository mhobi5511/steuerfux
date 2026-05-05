import Link from "next/link";
import { deleteIncome } from "@/app/actions/finance";
import { IncomeForm } from "@/components/forms/income-form";
import { PageHeader } from "@/components/layout/page-header";
import {
  MonthFilter,
  getSelectedMonth,
  matchesSelectedMonth
} from "@/components/records/month-filter";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { Button } from "@/components/ui/button";
import { getModuleData } from "@/lib/data";
import { normalizeIncomeStatus } from "@/lib/income-status";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

function IncomeStatusBadge({ status }: { status: string | null | undefined }) {
  const normalizedStatus = normalizeIncomeStatus(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
        normalizedStatus === "bezahlt"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {normalizedStatus}
    </span>
  );
}

export default async function IncomesPage({
  searchParams
}: {
  searchParams?: { edit?: string; month?: string };
}) {
  const { incomes, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const editing = incomes.find((income) => income.id === searchParams?.edit) ?? null;
  const selectedMonth = getSelectedMonth(searchParams?.month);
  const filteredIncomes = incomes.filter((income) =>
    matchesSelectedMonth(income.invoice_date, selectedMonth)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Einnahmen"
        description="Hier trennst du Rechnungsbetrag und echten Zahlungseingang sauber voneinander. Originalbetrag, Originalwährung, Wechselkurs und Berichtswährung bleiben nachvollziehbar."
      />
      <IncomeForm
        key={editing?.id ?? "new"}
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        reportingCurrency={reportingCurrency}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        defaultTaxMode={settings?.default_tax_mode ?? "BRUTTO"}
        initialValues={editing}
      />
      <MonthFilter action="/einnahmen" selectedMonth={selectedMonth} editId={searchParams?.edit} />
      <SimpleTable
        title="Gespeicherte Einnahmen"
        columns={["Rechnungsdatum", "Kunde / Projekt", "Status", "Originalbetrag", "Kurs", "Berichtswährung", "Aktion"]}
        emptyText="Noch keine Einnahmen erfasst."
        rows={filteredIncomes.map((income) => [
          formatDate(income.invoice_date),
          income.customer_project,
          <IncomeStatusBadge key={`${income.id}-status`} status={income.status} />,
          `${formatCurrency(income.invoice_amount_original, income.currency)} (${income.tax_mode})`,
          `${income.exchange_rate}`,
          `${formatCurrency(income.invoice_amount_reporting, reportingCurrency)} / Zahlung ${formatCurrency(income.payment_received_reporting, reportingCurrency)}`,
          <div key={income.id} className="flex gap-2">
            <Link href={`/einnahmen?edit=${income.id}&month=${selectedMonth}`}>
              <Button type="button" variant="ghost">
                Bearbeiten
              </Button>
            </Link>
            <DeleteButton id={income.id} action={deleteIncome} />
          </div>
        ])}
      />
    </div>
  );
}
