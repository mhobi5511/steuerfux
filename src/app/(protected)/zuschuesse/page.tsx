import { deleteReimbursement } from "@/app/actions/finance";
import { ReimbursementForm } from "@/components/forms/reimbursement-form";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function ReimbursementsPage() {
  const { reimbursements, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zuschüsse"
        description={
          settings?.steuerberater_view
            ? "Hier verwaltest du weiterberechenbare und erstattete Kosten getrennt von normalen Einnahmen."
            : null
        }
      />
      <ReimbursementForm
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        defaultTaxMode={settings?.default_tax_mode ?? "BRUTTO"}
      />
      <SimpleTable
        title="Gespeicherte Zuschüsse"
        columns={["Datum", "Beschreibung", "Status", "Zusammenhang", "Originalbetrag", "Berichtswährung", "Aktion"]}
        emptyText="Noch keine Zuschüsse erfasst."
        rows={reimbursements.map((item) => [
          formatDate(item.reimbursement_date),
          item.description,
          item.status,
          item.context_type,
          `${formatCurrency(item.original_amount, item.currency)} (${item.tax_mode})`,
          formatCurrency(item.amount_reporting, reportingCurrency),
          <DeleteButton key={item.id} id={item.id} action={deleteReimbursement} />
        ])}
      />
    </div>
  );
}
