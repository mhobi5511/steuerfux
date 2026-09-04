import { SettingsForm } from "@/components/forms/settings-form";
import { MileageSettingsForm } from "@/components/forms/mileage-settings-form";
import { InvoiceSettingsPanel } from "@/components/invoices/invoice-settings-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { getMileageYearSettings, getSettings } from "@/lib/data";
import { getInvoiceModuleData } from "@/lib/invoice-data";

export default async function SettingsPage() {
  const [settings, invoiceData, mileageSettings] = await Promise.all([
    getSettings(),
    getInvoiceModuleData({ includeInvoices: false }),
    getMileageYearSettings()
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Einstellungen"
        description={
          settings?.steuerberater_view
            ? "Hier legst du Standardwerte für Adresse, Währung, Geschäftsjahr und Kleinunternehmer-Modus fest."
            : null
        }
      />
      <SettingsForm
        settings={settings}
        activeBuchhaltungId={invoiceData.activeBuchhaltung?.id ?? null}
        destructiveResetEnabled={process.env.ENABLE_DESTRUCTIVE_DATA_RESET === "true"}
      />
      <MileageSettingsForm
        key={invoiceData.activeBuchhaltung?.id ?? "no-book"}
        activeBuchhaltung={invoiceData.activeBuchhaltung}
        settings={mileageSettings}
        initialYear={settings?.business_year ?? new Date().getFullYear()}
      />
      <InvoiceSettingsPanel
        activeBuchhaltung={invoiceData.activeBuchhaltung}
        invoiceSettings={invoiceData.invoiceSettings}
        bankAccounts={invoiceData.bankAccounts}
        customers={invoiceData.customers}
      />
      {settings?.steuerberater_view ? (
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">Hinweise zur rechtlichen Einordnung</h2>
        <p className="text-sm leading-6 text-slate-600">
          Die App unterstützt eine steueroptimierte, aber bewusst defensive Dokumentation.
          Unsichere Fälle wie gemischte Reisen, Abschreibungsgrenzen oder länderspezifische
          Pauschalen sollten immer plausibilisiert und bei Bedarf mit dem Steuerberater
          abgestimmt werden.
        </p>
      </Card>
      ) : null}
    </div>
  );
}
