import Link from "next/link";
import { deleteTrip } from "@/app/actions/finance";
import { TripForm } from "@/components/forms/trip-form";
import { SaveTripTemplateButton } from "@/components/forms/save-trip-template-button";
import { PageHeader } from "@/components/layout/page-header";
import { ReadOnlyNotice } from "@/components/layout/read-only-notice";
import {
  MonthFilter,
  getSelectedMonth,
  matchesSelectedMonth
} from "@/components/records/month-filter";
import { DeleteButton } from "@/components/records/delete-button";
import { SimpleTable } from "@/components/records/simple-table";
import { Button } from "@/components/ui/button";
import { getMileageYearSettings, getModuleData, getTripTemplates } from "@/lib/data";
import { createTripTemplatePreset } from "@/lib/trip-templates";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function TripsPage({
  searchParams
}: {
  searchParams?: Promise<{ duplicate?: string; edit?: string; month?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const [moduleData, mileageSettings, tripTemplates] = await Promise.all([
    getModuleData(undefined, ["trips", "reimbursements"]),
    getMileageYearSettings(),
    getTripTemplates()
  ]);
  const { trips, reimbursements, settings, activeBuchhaltung, businessYear } = moduleData;
  const reportingCurrency = settings?.reporting_currency ?? "EUR";
  const readOnly = activeBuchhaltung?.status === "abgeschlossen";
  const initialTrip = trips.find((trip) => trip.id === resolvedSearchParams?.edit) ?? null;
  const duplicateSource = initialTrip
    ? null
    : trips.find((trip) => trip.id === resolvedSearchParams?.duplicate) ?? null;
  const duplicatePreset = duplicateSource ? createTripTemplatePreset(duplicateSource) : null;
  const initialReimbursement =
    reimbursements.find((item) => item.source_trip_id === resolvedSearchParams?.edit) ?? null;
  const selectedMonth = getSelectedMonth(resolvedSearchParams?.month);
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
      {readOnly ? <ReadOnlyNotice /> : (
      <TripForm
        key={`${activeBuchhaltung?.id ?? "no-book"}-${initialTrip?.id ?? `new-${duplicateSource?.id ?? "blank"}`}`}
        homeAddress={settings?.default_home_address}
        businessCountry={settings?.business_country ?? "Deutschland"}
        reportingCurrency={reportingCurrency}
        defaultCurrency={settings?.default_currency ?? reportingCurrency}
        fallbackRate={settings?.default_manual_chf_eur_rate ?? 1}
        activeBuchhaltung={activeBuchhaltung}
        mileageSettings={mileageSettings}
        defaultYear={businessYear}
        templates={tripTemplates}
        initialTrip={initialTrip}
        duplicatePreset={duplicatePreset}
        initialReimbursement={initialReimbursement}
      />
      )}
      <MonthFilter
        action="/fahrten-reisen"
        selectedMonth={selectedMonth}
        editId={resolvedSearchParams?.edit}
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
          readOnly ? "Schreibgeschützt" : <div key={trip.id} className="flex flex-wrap gap-2">
            <Link href={`/fahrten-reisen?edit=${trip.id}&month=${selectedMonth}`}>
              <Button type="button" variant="ghost">
                Bearbeiten
              </Button>
            </Link>
            <Link href={`/fahrten-reisen?duplicate=${trip.id}&month=${selectedMonth}`}>
              <Button type="button" variant="ghost">
                Duplizieren
              </Button>
            </Link>
            <SaveTripTemplateButton tripId={trip.id} />
            <DeleteButton id={trip.id} action={deleteTrip} label="Reise" />
          </div>
        ])}
      />
    </div>
  );
}
