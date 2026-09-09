import Link from "next/link";
import { deleteIncome } from "@/app/actions/finance";
import { IncomeForm } from "@/components/forms/income-form";
import { PageHeader } from "@/components/layout/page-header";
import { ReadOnlyNotice } from "@/components/layout/read-only-notice";
import {
  MonthFilter,
  getSelectedMonth,
  matchesSelectedMonth
} from "@/components/records/month-filter";
import { DeleteButton } from "@/components/records/delete-button";
import { SimpleTable } from "@/components/records/simple-table";
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
  searchParams?: Promise<{ edit?: string; month?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { incomes, settings, activeBuchhaltung, businessYear } = await getModuleData(undefined, ["incomes"]);
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const readOnly = activeBuchhaltung?.status === "abgeschlossen";
  const editing = incomes.find((income) => income.id === resolvedSearchParams?.edit && !income.invoice_id) ?? null;
  const selectedMonth = getSelectedMonth(resolvedSearchParams?.month);
  const filteredIncomes = incomes.filter((income) =>
    String(income.payment_date ?? income.invoice_date).startsWith(`${businessYear}-`) &&
    matchesSelectedMonth(income.payment_date ?? income.invoice_date, selectedMonth)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Einnahmen"
        description={
          settings?.steuerberater_view
            ? "Hier trennst du Rechnungsbetrag und echten Zahlungseingang sauber voneinander. Originalbetrag, Originalwährung, Wechselkurs und Berichtswährung bleiben nachvollziehbar."
            : null
        }
      />
      {readOnly ? <ReadOnlyNotice /> : (
      <IncomeForm
        key={editing?.id ?? "new"}
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        reportingCurrency={reportingCurrency}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        defaultTaxMode={settings?.default_tax_mode ?? "BRUTTO"}
        initialValues={editing}
        showAdvisorDetails={Boolean(settings?.steuerberater_view)}
      />
      )}
      <MonthFilter action="/einnahmen" selectedMonth={selectedMonth} editId={resolvedSearchParams?.edit} />
      <SimpleTable
        title="Einnahmen und manuelle Einträge"
        columns={["Zahlungsdatum / Rechnungsdatum", "Kunde / Projekt", "Status", "Originalbetrag", "Kurs", "Berichtswährung", "Aktion"]}
        emptyText="Noch keine Einnahmen erfasst."
        rows={filteredIncomes.filter((income) => !income.invoice_id || income.payment_date).map((income) => [
          formatDate(income.payment_date ?? income.invoice_date),
          income.customer_project,
          <IncomeStatusBadge key={`${income.id}-status`} status={income.status} />,
          `${formatCurrency(income.invoice_amount_original, income.currency)} (${income.tax_mode})`,
          `${income.exchange_rate}`,
          `${formatCurrency(income.invoice_amount_reporting, reportingCurrency)} / Zahlung ${formatCurrency(income.payment_received_reporting, reportingCurrency)}`,
          income.invoice_id ? <Link key={income.id} href="/rechnungen">{income.invoice_payment_id ? "Rechnungszahlung (fest gebucht)" : "Historische Rechnungsbuchung"}</Link> : readOnly ? "Schreibgeschützt" : <div key={income.id} className="flex flex-wrap gap-2">
            <Link href={`/einnahmen?edit=${income.id}&month=${selectedMonth}`}>
              <Button type="button" variant="ghost">
                Bearbeiten
              </Button>
            </Link>
            <DeleteButton id={income.id} action={deleteIncome} label="Einnahme" />
          </div>
        ])}
      />
      <details className="rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer">Historische Forderungseinträge ({filteredIncomes.filter((income) => income.invoice_id && !income.payment_date).length})</summary>
        <p className="my-3 text-sm">Unveränderter Altbestand ohne Zahlungseingang. Aktuelle offene Beträge und Stornierungen stehen bei den Rechnungen.</p>
        {filteredIncomes.filter((income) => income.invoice_id && !income.payment_date).map((income) => <p key={income.id} className="py-2">
          {formatDate(income.invoice_date)} · {income.customer_project} · {formatCurrency(income.invoice_amount_original, income.currency)} · <Link href="/rechnungen">Rechnung ansehen</Link>
        </p>)}
      </details>
    </div>
  );
}
