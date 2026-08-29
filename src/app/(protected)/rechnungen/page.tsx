import { InvoiceModule } from "@/components/invoices/invoice-module";
import { PageHeader } from "@/components/layout/page-header";
import { getInvoiceModuleData } from "@/lib/invoice-data";

export default async function InvoicesPage({
  searchParams
}: {
  searchParams?: Promise<{ edit?: string; neu?: string; filter?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
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
        editId={resolvedSearchParams?.edit ?? undefined}
        create={resolvedSearchParams?.neu === "1"}
        filter={resolvedSearchParams?.filter ?? "Alle"}
      />
    </div>
  );
}
