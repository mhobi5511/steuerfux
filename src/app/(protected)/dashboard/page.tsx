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
  const showAdvisorDetails = Boolean(data.settings?.steuerberater_view);

  const visibleKpis = [
    {
      label: "Zahlungseingänge gesamt",
      value: data.kpis.paymentReceivedTotal,
      note: "Summe aller tatsächlich erhaltenen Zahlungen in Berichtswährung."
    },
    {
      label: "Bank- und Wechselgebühren",
      value: data.kpis.feeTotal,
      note: "Alle Bankgebühren, Zahlungsanbieter- und Wechselkurskosten."
    },
    {
      label: "Fahrtkosten",
      value: data.kpis.tripDrivingTotal,
      note: "Summe aller Fahrtenpauschalen aus Kilometern mal 0,30."
    },
    {
      label: "Reisekosten und Verpflegung",
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
        description={
          showAdvisorDetails
            ? "Alle Kennzahlen werden direkt aus deiner Datenbank berechnet und klar in deiner Berichtswährung dargestellt."
            : null
        }
      />

      {searchParams?.reset === "1" ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-700">Alle Daten wurden gelöscht.</p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleKpis.map((item) => (
          <KpiCard
            key={item.label}
            label={item.label}
            value={formatCurrency(item.value, data.reportingCurrency)}
            note={showAdvisorDetails ? item.note : undefined}
          />
        ))}
        <TaxRateCard
          initialTaxRate={estimatedTaxRate}
          taxableProfit={data.kpis.taxRelevantProfit}
          reportingCurrency={data.reportingCurrency}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Monatsübersicht {data.businessYear}
            </h2>
            <p className="hidden text-sm text-slate-600 sm:block">
              Einnahmen, Kundenbeteiligungen, Kosten und Monatsresultat auf einen Blick.
            </p>
          </div>

          <div className="grid gap-3 md:hidden">
            {data.monthly.map((row) => (
              <div
                key={row.month}
                className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.22)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                      Monat
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{row.month}</p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {formatCurrency(row.result, data.reportingCurrency)}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 text-sm">
                    <span className="text-slate-500">Zahlungseingänge</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(row.incomes, data.reportingCurrency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 text-sm">
                    <span className="text-slate-500">Kundenbeteiligung</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(row.clientShare, data.reportingCurrency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-slate-500">Kosten</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(row.costs, data.reportingCurrency)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
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
                    <td className="px-4 py-3">
                      {formatCurrency(row.incomes, data.reportingCurrency)}
                    </td>
                    <td className="px-4 py-3">
                      {formatCurrency(row.clientShare, data.reportingCurrency)}
                    </td>
                    <td className="px-4 py-3">
                      {formatCurrency(row.costs, data.reportingCurrency)}
                    </td>
                    <td className="px-4 py-3">
                      {formatCurrency(row.result, data.reportingCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {showAdvisorDetails ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Details</h2>
            <p className="text-sm text-slate-600">
              Hilfreich für Plausibilitätsprüfung und offene Punkte.
            </p>
          </div>

          <div className="space-y-3 text-sm text-slate-700">
            <div className="rounded-[1.35rem] bg-slate-50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                Abschreibung
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {formatCurrency(
                  data.helperSamples.depreciation.yearlyAmountReporting,
                  data.reportingCurrency
                )}{" "}
                pro Jahr
              </p>
            </div>

            <div className="rounded-[1.35rem] bg-slate-50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                Fahrtkosten
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {formatCurrency(data.helperSamples.trips.drivingDeduction, data.reportingCurrency)}
              </p>
            </div>

            <div className="rounded-[1.35rem] bg-slate-50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                Länder-Pauschalen
              </p>
              <p className="mt-1 leading-6">
                {data.rateReference.map((rate) => rate.country).join(", ")}
              </p>
            </div>

            <div className="rounded-[1.35rem] bg-slate-50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                Berichtswährung
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {data.reportingCurrency}
              </p>
            </div>
          </div>
        </Card>
        ) : null}
      </div>
    </div>
  );
}
