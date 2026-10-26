import { InvoiceModule } from "@/components/invoices/invoice-module";
import { PageHeader } from "@/components/layout/page-header";
import { getInvoiceModuleData } from "@/lib/invoice-data";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rechnungen" };

export default async function InvoicesPage({
  searchParams
}: {
  searchParams?: Promise<{ edit?: string; neu?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const data = await getInvoiceModuleData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rechnungen"
        description="Offene Forderungen, überfällige und bezahlte Rechnungen verwalten und Zahlungseingänge erfassen."
      />
      <InvoiceModule
        activeBuchhaltung={data.activeBuchhaltung}
        customers={data.customers}
        invoices={data.invoices}
        invoiceSettings={data.invoiceSettings}
        bankAccounts={data.bankAccounts}
        editId={resolvedSearchParams?.edit ?? undefined}
        create={resolvedSearchParams?.neu === "1"}
      />
    </div>
  );
}
