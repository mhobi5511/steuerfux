import { BankFeeForm } from "@/components/forms/bank-fee-form";
import { PageHeader } from "@/components/layout/page-header";
import { SimpleTable } from "@/components/records/simple-table";
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
        columns={["Datum", "Art", "Berichtswährung"]}
        emptyText="Noch keine Gebühren erfasst."
        compactMobile
        rows={fees.map((fee) => [
          formatDate(fee.fee_date),
          fee.fee_type,
          formatCurrency(fee.amount_reporting, reportingCurrency)
        ])}
      />
    </div>
  );
}
