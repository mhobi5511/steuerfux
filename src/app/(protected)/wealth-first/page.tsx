import type { Metadata } from "next";
import { WealthFirstModule } from "@/components/wealth-first/wealth-first-module";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { getAccountingContext } from "@/lib/data";
import { getWealthFirstData } from "@/lib/wealth-first-data";

export const metadata: Metadata = { title: "Wealth First" };

export default async function WealthFirstPage() {
  const { activeBuchhaltung } = await getAccountingContext();

  if (!activeBuchhaltung) {
    return (
      <div className="space-y-6">
        <PageHeader title="Wealth First" />
        <Card>Bitte zuerst eine Buchhaltung anlegen.</Card>
      </div>
    );
  }

  if (
    activeBuchhaltung.country !== "Schweiz" ||
    activeBuchhaltung.reporting_currency !== "CHF"
  ) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Wealth First"
          description="Liquiditätsverteilung für die Schweizer CHF-Buchhaltung."
        />
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-slate-950">In dieser Buchhaltung nicht verfügbar</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Wealth First ist bewusst nur für die Schweizer CHF-Buchhaltung aktiviert. Für die
            deutsche Buchhaltung werden keine Verteilungsregeln angewendet.
          </p>
        </Card>
      </div>
    );
  }

  const data = await getWealthFirstData();
  if (data.migrationMissing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Wealth First" />
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-slate-950">Migration noch nicht eingespielt</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Führe die additive Migration <code>202610260001_wealth_first.sql</code> manuell in
            Supabase aus. Die App führt keine Produktionsmigration automatisch aus.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <WealthFirstModule
      buchhaltung={activeBuchhaltung}
      settings={data.settings}
      pots={data.pots}
      distributions={data.distributions}
      reconciliations={data.reconciliations}
    />
  );
}
