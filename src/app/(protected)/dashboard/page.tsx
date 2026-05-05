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
  const tripAndTravelTotal = data.kpis.tripDrivingTotal + data.kpis.tripTravelTotal;
  const operatingExpensesTotal = data.kpis.deductibleExpensesTotal + data.kpis.depreciationTotal;

  const compactKpis = [
    {
      label: "Umsatz",
      value: data.kpis.paymentReceivedTotal
    },
    {
      label: "Gebühren",
      value: data.kpis.feeTotal
    },
    {
      label: "Fahrt-, Reise- und Verpflegungskosten",
      value: tripAndTravelTotal
    },
    {
      label: "Ausgaben",
      value: operatingExpensesTotal
    },
    {
      label: "Steuerlich relevanter Betrag",
      value: data.kpis.taxRelevantProfit
    }
  ];

  const advisorKpis = [
    {
      label: "Rechnungssumme",
      value: data.kpis.incomeTotal,
      note: "Alle erfassten Rechnungen im Geschäftsjahr."
    },
    {
      label: "Umsatz",
      value: data.kpis.paymentReceivedTotal,
      note: "Tatsächlich erhaltene Zahlungen."
    },
    {
      label: "Offene Einnahmen",
      value: data.kpis.openIncomeTotal,
      note: "Noch nicht bezahlte oder offene Differenzen."
    },
    {
      label: "Gebühren",
      value: data.kpis.feeTotal,
      note: "Bank-, Zahlungsanbieter- und Wechselgebühren."
    },
    {
      label: "Fahrtkosten",
      value: data.kpis.tripDrivingTotal,
      note: "Kilometerpauschalen aus Fahrten und Reisen."
    },
    {
      label: "Reise und Verpflegung",
      value: data.kpis.tripTravelTotal,
      note: "Reisekosten und Verpflegungspauschalen."
    },
    {
      label: "Ausgaben",
      value: data.kpis.deductibleExpensesTotal,
      note: "Steuerlich relevante Ausgaben nach Kundenbeteiligung."
    },
    {
      label: "Abschreibungen",
      value: data.kpis.depreciationTotal,
      note: "Jahresanteil der linearen Abschreibungen."
    },
    {
      label: "Steuerlich relevanter Betrag",
      value: data.kpis.taxRelevantProfit,
      note: "Umsatz minus steuerlich relevante Kosten."
    }
  ];

  const visibleKpis = showAdvisorDetails ? advisorKpis : compactKpis;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          showAdvisorDetails
            ? "Aufgeschlüsselte Sicht für Prüfung, Export und Steuerberater."
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
            note={"note" in item && typeof item.note === "string" ? item.note : undefined}
          />
        ))}
        <TaxRateCard
          initialTaxRate={estimatedTaxRate}
          taxableProfit={data.kpis.taxRelevantProfit}
          reportingCurrency={data.reportingCurrency}
        />
      </div>

      {showAdvisorDetails ? (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Monatsübersicht {data.businessYear}
              </h2>
              <p className="hidden text-sm text-slate-600 sm:block">
                Einnahmen, Kundenbeteiligungen, Kosten und Monatsresultat.
              </p>
            </div>

            <div className="grid gap-3 md:hidden">
              {data.monthly.map((row) => (
                <div
                  key={row.month}
                  className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.22)] dark:border-slate-800 dark:bg-slate-900"
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
                      <span className="text-slate-500">Umsatz</span>
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
                    <th className="px-4 py-3">Umsatz</th>
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

          <Card className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Details</h2>
              <p className="text-sm text-slate-600">
                Referenzwerte für Plausibilitätsprüfung und Export.
              </p>
            </div>

            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-[1.35rem] bg-slate-50 p-4 dark:bg-slate-900">
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

              <div className="rounded-[1.35rem] bg-slate-50 p-4 dark:bg-slate-900">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  Fahrtkosten
                </p>
                <p className="mt-1 text-base font-semibold text-slate-950">
                  {formatCurrency(
                    data.helperSamples.trips.drivingDeduction,
                    data.reportingCurrency
                  )}
                </p>
              </div>

              <div className="rounded-[1.35rem] bg-slate-50 p-4 dark:bg-slate-900">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  Länder-Pauschalen
                </p>
                <p className="mt-1 leading-6">
                  {data.rateReference.map((rate) => rate.country).join(", ")}
                </p>
              </div>

              <div className="rounded-[1.35rem] bg-slate-50 p-4 dark:bg-slate-900">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  Berichtswährung
                </p>
                <p className="mt-1 text-base font-semibold text-slate-950">
                  {data.reportingCurrency}
                </p>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
