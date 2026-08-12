import { InvoiceModule } from "@/components/invoices/invoice-module";
import { PageHeader } from "@/components/layout/page-header";
import { getInvoiceModuleData } from "@/lib/invoice-data";

export default async function InvoicesPage({
  searchParams
}: {
  searchParams?: { edit?: string; filter?: string };
}) {
  const data = await getInvoiceModuleData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rechnungen"
        description="Rechnungen erstellen, ausstellen, als PDF ansehen, versenden und Zahlungen als Einnahmen erfassen."
      />
      <InvoiceModule
        activeBuchhaltung={data.activeBuchhaltung}
        customers={data.customers}
        invoices={data.invoices}
        invoiceSettings={data.invoiceSettings}
        bankAccounts={data.bankAccounts}
        editId={searchParams?.edit ?? undefined}
        filter={searchParams?.filter ?? "Alle"}
      />
    </div>
  );
}
