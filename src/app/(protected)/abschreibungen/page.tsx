import Link from "next/link";
import { deleteDepreciation } from "@/app/actions/finance";
import { DepreciationForm } from "@/components/forms/depreciation-form";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function DepreciationsPage({
  searchParams
}: {
  searchParams?: { edit?: string };
}) {
  const { depreciations, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const editing = depreciations.find((item) => item.id === searchParams?.edit) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abschreibungen"
        description="Hier verwaltest du langlebige Anschaffungen getrennt von normalen Ausgaben. Die lineare Abschreibung wird automatisch in der Berichtswährung berechnet."
      />
      <DepreciationForm
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        initialValues={editing ?? undefined}
      />
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
          <div key={item.id} className="flex gap-3">
            <Link href={`/abschreibungen?edit=${item.id}`} className="text-sm text-brand-700">
              Bearbeiten
            </Link>
            <DeleteButton id={item.id} action={deleteDepreciation} />
          </div>
        ])}
      />
    </div>
  );
}
