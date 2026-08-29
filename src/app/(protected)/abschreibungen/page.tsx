import Link from "next/link";
import { deleteDepreciation } from "@/app/actions/finance";
import { DepreciationForm } from "@/components/forms/depreciation-form";
import { PageHeader } from "@/components/layout/page-header";
import { ReadOnlyNotice } from "@/components/layout/read-only-notice";
import { DeleteButton } from "@/components/records/delete-button";
import { SimpleTable } from "@/components/records/simple-table";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function DepreciationsPage({
  searchParams
}: {
  searchParams?: Promise<{ edit?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { depreciations, settings, activeBuchhaltung } = await getModuleData(undefined, [
    "depreciations"
  ]);
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const readOnly = activeBuchhaltung?.status === "abgeschlossen";
  const editing = depreciations.find((item) => item.id === resolvedSearchParams?.edit) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abschreibungen"
        description={
          settings?.steuerberater_view
            ? "Hier verwaltest du langlebige Anschaffungen getrennt von normalen Ausgaben. Die lineare Abschreibung wird automatisch in der Berichtswährung berechnet."
            : null
        }
      />
      {readOnly ? <ReadOnlyNotice /> : (
      <DepreciationForm
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        initialValues={editing ?? undefined}
      />
      )}
      <SimpleTable
        title="Gespeicherte Abschreibungen"
        columns={["Anschaffung", "Datum", "Anschaffungswert", "Jährlich", "Bisher abgeschrieben", "Restwert", "Aktion"]}
        emptyText="Noch keine Abschreibungen erfasst."
        rows={depreciations.map((item) => [
          item.description,
          formatDate(item.acquisition_date),
          formatCurrency(item.amount_reporting, reportingCurrency),
          formatCurrency(item.yearly_amount_reporting, reportingCurrency),
          formatCurrency(item.deducted_until_year_reporting, reportingCurrency),
          formatCurrency(item.remaining_value_reporting, reportingCurrency),
          readOnly ? "Schreibgeschützt" : <div key={item.id} className="flex flex-wrap gap-2">
            <Link
              href={`/abschreibungen?edit=${item.id}`}
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700"
            >
              Bearbeiten
            </Link>
            <DeleteButton id={item.id} action={deleteDepreciation} label="Abschreibung" />
          </div>
        ])}
      />
    </div>
  );
}
