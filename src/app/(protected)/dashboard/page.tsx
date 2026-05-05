import { KpiCard } from "@/components/dashboard/kpi-card";
import { TaxRateCard } from "@/components/dashboard/tax-rate-card";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { getDashboardData } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: { reset?: string };
}) {
  const data = await getDashboardData();
  const estimatedTaxRate = data.settings?.estimated_tax_rate ?? 0;

  const visibleKpis = [
    {
      label: "Zahlungseingänge gesamt",
      value: data.kpis.paymentReceivedTotal,
      note: "Summe aller tatsächlich erhaltenen Zahlungen in Berichtswährung."
    },
    {
      label: "Bank- & Wechselgebühren",
      value: data.kpis.feeTotal,
      note: "Alle Bankgebühren, Zahlungsanbieter- und Wechselkurskosten."
    },
    {
      label: "Fahrtkosten",
      value: data.kpis.tripDrivingTotal,
      note: "Summe aller Fahrtenpauschalen aus Kilometern × 0,30."
    },
    {
      label: "Reisekosten / Verpflegung",
      value: data.kpis.tripTravelTotal,
      note: "Reisekosten plus Verpflegungspauschalen aller Reisen."
    },
    {
      label: "Abschreibungen",
      value: data.kpis.depreciationTotal,
      note: "Summe aller Jahresabschreibungen."
    },
    {
      label: "Nicht erstattete Kosten",
      value: data.kpis.unreimbursedCosts,
      note: "Aktuell die Summe aller effektiven Ausgaben nach Kundenbeteiligung."
    },
    {
      label: "Steuerlich absetzbare Kosten",
      value: data.kpis.deductibleCostTotal,
      note: "Abziehbare Ausgaben plus Gebühren, Fahrtkosten, Reisen und Abschreibungen."
    },
    {
      label: "Steuerlich relevanter Gewinn",
      value: data.kpis.taxRelevantProfit,
      note: "Zahlungseingänge gesamt minus steuerlich absetzbare Kosten."
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Alle Kennzahlen werden direkt aus deiner Datenbank berechnet und konsequent in deiner Berichtswährung dargestellt."
      />

      {searchParams?.reset === "1" ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-700">Alle Daten wurden gelöscht</p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleKpis.map((item) => (
          <KpiCard
            key={item.label}
            label={item.label}
            value={formatCurrency(item.value, data.reportingCurrency)}
            note={item.note}
          />
        ))}
        <TaxRateCard
          initialTaxRate={estimatedTaxRate}
          taxableProfit={data.kpis.taxRelevantProfit}
          reportingCurrency={data.reportingCurrency}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Monatsübersicht {data.businessYear}</h2>
            <p className="text-sm text-slate-600">
              Einnahmen, Kundenbeteiligungen, Kosten und Monatsresultat auf einen Blick.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3">Monat</th>
                  <th className="px-4 py-3">Zahlungseingänge</th>
                  <th className="px-4 py-3">Kundenbeteiligung</th>
                  <th className="px-4 py-3">Kosten</th>
                  <th className="px-4 py-3">Resultat</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((row) => (
                  <tr key={row.month} className="border-t border-line">
                    <td className="px-4 py-3">{row.month}</td>
                    <td className="px-4 py-3">{formatCurrency(row.incomes, data.reportingCurrency)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.clientShare, data.reportingCurrency)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.costs, data.reportingCurrency)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.result, data.reportingCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Steuerberater-Details</h2>
            <p className="text-sm text-slate-600">
              Hilfreich für Plausibilitätsprüfung und offene Punkte.
            </p>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Beispiel lineare Abschreibung:{" "}
              {formatCurrency(
                data.helperSamples.depreciation.yearlyAmountReporting,
                data.reportingCurrency
              )}{" "}
              pro Jahr
            </p>
            <p>
              Beispiel Fahrtkosten:{" "}
              {formatCurrency(data.helperSamples.trips.drivingDeduction, data.reportingCurrency)}
            </p>
            <p>Hinterlegte Länder-Pauschalen: {data.rateReference.map((rate) => rate.country).join(", ")}</p>
            <p>Aktive Berichtswährung: {data.reportingCurrency}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
