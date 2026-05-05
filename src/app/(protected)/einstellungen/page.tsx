import { SettingsForm } from "@/components/forms/settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { getSettings } from "@/lib/data";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Einstellungen"
        description="Hier legst du Standardwerte für Adresse, Währung, Geschäftsjahr und Kleinunternehmer-Modus fest. Diese Werte helfen bei schneller, konsistenter Datenerfassung."
      />
      <SettingsForm settings={settings} />
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">Hinweise zur rechtlichen Einordnung</h2>
        <p className="text-sm leading-6 text-slate-600">
          Die App unterstützt eine steueroptimierte, aber bewusst defensive Dokumentation.
          Unsichere Fälle wie gemischte Reisen, Abschreibungsgrenzen oder länderspezifische
          Pauschalen sollten immer plausibilisiert und bei Bedarf mit dem Steuerberater
          abgestimmt werden.
        </p>
      </Card>
    </div>
  );
}
