import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { getDashboardData } from "@/lib/data";

const exportLinks = [
  { key: "einnahmen", label: "CSV Einnahmen" },
  { key: "ausgaben", label: "CSV Ausgaben" },
  { key: "bankgebuehren", label: "CSV Bank- & Wechselgebühren" },
  { key: "fahrten", label: "CSV Fahrten & Reisen" },
  { key: "abschreibungen", label: "CSV Abschreibungen" },
  { key: "jahresuebersicht", label: "Jahresübersicht CSV" }
];

export default async function ExportPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Export & Jahresabschluss"
        description={`Exporte enthalten Datum, Kategorie, Beschreibung, Originalbetrag, Währung, Zahlungsdatum, Wechselkurs, Betrag in ${data.reportingCurrency}, Netto/Brutto und Berechnungshinweise, soweit im Datensatz vorhanden.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-950">CSV-Exporte</h2>
          <div className="grid gap-3">
            {exportLinks.map((item) => (
              <Link
                key={item.key}
                href={`/api/export/${item.key}?year=${data.businessYear}`}
                className="rounded-xl border border-line px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-950">Jahresreport / PDF</h2>
          <p className="text-sm leading-6 text-slate-600">
            Für das MVP wird der Jahresreport als saubere HTML-Druckansicht erzeugt. Diese kann im Browser direkt als PDF gespeichert werden und eignet sich für die Steuerberater-Ansicht.
          </p>
          <Link
            href={`/api/report?year=${data.businessYear}`}
            target="_blank"
            className="inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white"
          >
            Druckansicht öffnen
          </Link>
        </Card>
      </div>
    </div>
  );
}
