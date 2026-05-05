import Link from "next/link";
import { deleteTrip } from "@/app/actions/finance";
import { TripForm } from "@/components/forms/trip-form";
import { PageHeader } from "@/components/layout/page-header";
import {
  MonthFilter,
  getSelectedMonth,
  matchesSelectedMonth
} from "@/components/records/month-filter";
import { DeleteButton, SimpleTable } from "@/components/records/simple-table";
import { Button } from "@/components/ui/button";
import { getModuleData } from "@/lib/data";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function TripsPage({
  searchParams
}: {
  searchParams?: { edit?: string; month?: string };
}) {
  const { trips, reimbursements, settings } = await getModuleData();
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const initialTrip = trips.find((trip) => trip.id === searchParams?.edit) ?? null;
  const initialReimbursement =
    reimbursements.find((item) => item.source_trip_id === searchParams?.edit) ?? null;
  const selectedMonth = getSelectedMonth(searchParams?.month);
  const filteredTrips = trips.filter((trip) => matchesSelectedMonth(trip.start_at, selectedMonth));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fahrten & Reisen"
        description={
          settings?.steuerberater_view
            ? "Reisen werden als klare Route mit Start, Stopps und Rückkehr erfasst. Verpflegungspauschalen werden pro Tag nachvollziehbar berechnet und private Stopps gesondert markiert."
            : null
        }
      />
      <TripForm
        key={initialTrip?.id ?? "new"}
        homeAddress={settings?.default_home_address}
        businessCountry={settings?.business_country ?? "Deutschland"}
        reportingCurrency={reportingCurrency}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        initialTrip={initialTrip}
        initialReimbursement={initialReimbursement}
      />
      <MonthFilter
        action="/fahrten-reisen"
        selectedMonth={selectedMonth}
        editId={searchParams?.edit}
      />
      <SimpleTable
        title="Gespeicherte Reisen"
        columns={[
          "Reise",
          "Zeitraum",
          "Gesamtkilometer",
          "Fahrtkosten",
          "Verpflegung",
          "Warnung",
          "Aktion"
        ]}
        emptyText="Noch keine Reisen erfasst."
        rows={filteredTrips.map((trip) => [
          trip.title,
          `${formatDateTime(trip.start_at)} → ${formatDateTime(trip.end_at)}`,
          `${trip.total_km} km`,
          formatCurrency(trip.driving_deduction_reporting, reportingCurrency),
          formatCurrency(trip.total_per_diem_reporting, reportingCurrency),
          trip.mixed_trip_warning ?? "-",
          <div key={trip.id} className="flex flex-wrap gap-2">
            <Link href={`/fahrten-reisen?edit=${trip.id}&month=${selectedMonth}`}>
              <Button type="button" variant="ghost">
                Bearbeiten
              </Button>
            </Link>
            <DeleteButton id={trip.id} action={deleteTrip} />
          </div>
        ])}
      />
    </div>
  );
}
