import { deleteBankFee } from "@/app/actions/finance";
import { BankFeeForm } from "@/components/forms/bank-fee-form";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function BankFeesPage() {
  const { fees, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank- & Wechselgebühren"
        description={
          settings?.steuerberater_view
            ? "Diese Seite sammelt Bankgebühren, Wechselkursverluste, Zahlungsanbieter-Kosten und automatisch erkannte Zahlungsdifferenzen aus Einnahmen."
            : null
        }
      />
      <BankFeeForm
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
      />
      <SimpleTable
        title="Gespeicherte Gebühren"
        columns={["Datum", "Art", "Originalbetrag", "Berichtswährung", "Beschreibung", "Aktion"]}
        emptyText="Noch keine Gebühren erfasst."
        rows={fees.map((fee) => [
          formatDate(fee.fee_date),
          fee.fee_type,
          formatCurrency(fee.original_amount, fee.currency),
          formatCurrency(fee.amount_reporting, reportingCurrency),
          fee.description ?? "—",
          <DeleteButton key={fee.id} id={fee.id} action={deleteBankFee} />
        ])}
      />
    </div>
  );
}
