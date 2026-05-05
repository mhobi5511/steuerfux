"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { upsertTrip } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { homeAddressDefault, tripPurposeOptions } from "@/lib/constants";
import type {
  BusinessCountry,
  CurrencyCode,
  Reimbursement,
  ReportingCurrency,
  Trip,
  TripPurpose
} from "@/lib/db-types";
import { buildPerDiemBreakdown, calculateTripTotals } from "@/lib/trips";
import { formatCurrency, toDateTimeLocalValue } from "@/lib/utils";

type Stop = {
  id: string;
  location: string;
  country: string;
  arrival_at: string;
  departure_at: string;
  purpose: TripPurpose;
  breakfast_provided: boolean;
  lunch_provided: boolean;
  dinner_provided: boolean;
  note: string;
};

type Segment = {
  id: string;
  from_label: string;
  to_label: string;
  kilometers: number;
  is_business: boolean;
};

function createSegment(fromLabel: string, toLabel: string): Segment {
  return {
    id: crypto.randomUUID(),
    from_label: fromLabel,
    to_label: toLabel,
    kilometers: 0,
    is_business: true
  };
}

function buildDefaultSegments(homeAddress: string) {
  return [createSegment(homeAddress, homeAddress)];
}

function mapTripToStops(trip?: Trip | null): Stop[] {
  if (!trip?.trip_stops?.length) return [];

  return [...trip.trip_stops]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((stop) => ({
      id: stop.id,
      location: stop.location,
      country: stop.country,
      arrival_at: toDateTimeLocalValue(stop.arrival_at),
      departure_at: toDateTimeLocalValue(stop.departure_at),
      purpose: stop.purpose,
      breakfast_provided: stop.breakfast_provided,
      lunch_provided: stop.lunch_provided,
      dinner_provided: stop.dinner_provided,
      note: stop.note ?? ""
    }));
}

function mapTripToSegments(trip: Trip | null | undefined, homeAddress: string): Segment[] {
  if (!trip?.trip_segments?.length) {
    return buildDefaultSegments(trip?.start_point || homeAddress);
  }

  return [...trip.trip_segments]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((segment) => ({
      id: segment.id,
      from_label: segment.from_label,
      to_label: segment.to_label,
      kilometers: segment.kilometers,
      is_business: segment.is_business
    }));
}

export function TripForm({
  homeAddress = homeAddressDefault,
  businessCountry,
  reportingCurrency,
  defaultCurrency,
  fallbackRate,
  initialTrip = null,
  initialReimbursement = null
}: {
  homeAddress?: string;
  businessCountry: BusinessCountry;
  reportingCurrency: ReportingCurrency;
  defaultCurrency: CurrencyCode;
  fallbackRate: number;
  initialTrip?: Trip | null;
  initialReimbursement?: Reimbursement | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(initialTrip?.start_at));
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(initialTrip?.end_at));
  const [stops, setStops] = useState<Stop[]>(() => mapTripToStops(initialTrip));
  const [startPoint, setStartPoint] = useState(initialTrip?.start_point ?? homeAddress);
  const [endPoint, setEndPoint] = useState(initialTrip?.end_point ?? homeAddress);
  const [reimbursableToClient, setReimbursableToClient] = useState(
    initialTrip?.reimbursable_to_client ? "true" : "false"
  );
  const [reimbursementAmount, setReimbursementAmount] = useState(
    initialReimbursement?.original_amount ? String(initialReimbursement.original_amount) : ""
  );
  const [reimbursementCurrency, setReimbursementCurrency] = useState<CurrencyCode>(
    initialReimbursement?.currency ?? defaultCurrency
  );
  const [reimbursementRate, setReimbursementRate] = useState(
    initialReimbursement?.exchange_rate ?? 1
  );
  const [segments, setSegments] = useState<Segment[]>(() =>
    mapTripToSegments(initialTrip, homeAddress)
  );

  const isEditing = Boolean(initialTrip?.id);

  useEffect(() => {
    setStartAt(toDateTimeLocalValue(initialTrip?.start_at));
    setEndAt(toDateTimeLocalValue(initialTrip?.end_at));
    setStops(mapTripToStops(initialTrip));
    setStartPoint(initialTrip?.start_point ?? homeAddress);
    setEndPoint(initialTrip?.end_point ?? homeAddress);
    setReimbursableToClient(initialTrip?.reimbursable_to_client ? "true" : "false");
    setReimbursementAmount(
      initialReimbursement?.original_amount ? String(initialReimbursement.original_amount) : ""
    );
    setReimbursementCurrency(initialReimbursement?.currency ?? defaultCurrency);
    setReimbursementRate(initialReimbursement?.exchange_rate ?? 1);
    setSegments(mapTripToSegments(initialTrip, homeAddress));
    setSuccess(null);
    setError(null);
  }, [defaultCurrency, homeAddress, initialReimbursement, initialTrip]);

  function rebuildSegments(nextStart: string, nextEnd: string, nextStops: Stop[]) {
    const labels = [nextStart, ...nextStops.map((stop) => stop.location || "Zwischenstopp"), nextEnd];
    const nextSegments = labels.slice(0, -1).map((label, index) => ({
      id: segments[index]?.id ?? crypto.randomUUID(),
      from_label: label,
      to_label: labels[index + 1],
      kilometers: segments[index]?.kilometers ?? 0,
      is_business: nextStops[index]?.purpose !== "Privat"
    }));
    setSegments(nextSegments);
  }

  function addStop() {
    const nextStops = [
      ...stops,
      {
        id: crypto.randomUUID(),
        location: "",
        country: "",
        arrival_at: "",
        departure_at: "",
        purpose: tripPurposeOptions[0] as TripPurpose,
        breakfast_provided: false,
        lunch_provided: false,
        dinner_provided: false,
        note: ""
      }
    ];

    setStops(nextStops);
    rebuildSegments(startPoint, endPoint, nextStops);
  }

  function removeStop(id: string) {
    const nextStops = stops.filter((stop) => stop.id !== id);
    setStops(nextStops);
    rebuildSegments(startPoint, endPoint, nextStops);
  }

  const totals = useMemo(() => calculateTripTotals(segments), [segments]);
  const perDiemPreview = useMemo(
    () =>
      buildPerDiemBreakdown({
        startAt,
        endAt,
        stops,
        businessCountry
      }),
    [businessCountry, endAt, startAt, stops]
  );

  function resetForm() {
    formRef.current?.reset();
    setSuccess(null);
    setError(null);
    setStartAt("");
    setEndAt("");
    setStops([]);
    setStartPoint(homeAddress);
    setEndPoint(homeAddress);
    setReimbursableToClient("false");
    setReimbursementAmount("");
    setReimbursementCurrency(defaultCurrency);
    setReimbursementRate(1);
    setSegments(buildDefaultSegments(homeAddress));
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">
          {isEditing ? "Reise bearbeiten" : "Neue Fahrt / Reise"}
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Trage deine Reise Schritt für Schritt ein: Start {">"} alle Zwischenstopps {">"} Rückkehr.
          Die Verpflegungspauschalen werden pro Kalendertag mit Land, Abwesenheit und
          Mahlzeitenkürzung aufgeschlüsselt.
        </p>
      </div>

      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await upsertTrip(formData);
            if (result.success) {
              if (isEditing) {
                setSuccess(result.success);
              } else {
                resetForm();
                setSuccess(result.success);
              }
            }
            if (result.error) {
              setError(result.error);
            }
          })
        }
        className="space-y-6"
      >
        {isEditing ? <input name="id" type="hidden" value={initialTrip?.id} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Reisebezeichnung">
            <Input
              name="title"
              required
              placeholder="z. B. LED Drumshow Schweiz"
              defaultValue={initialTrip?.title ?? ""}
            />
          </Field>
          <Field label="Geschäftlicher Anlass">
            <Input
              name="business_reason"
              placeholder="z. B. Probe, Auftritt, Meeting"
              defaultValue={initialTrip?.business_reason ?? ""}
            />
          </Field>
          <Field label="Startpunkt">
            <Input
              name="start_point"
              value={startPoint}
              onChange={(event) => {
                setStartPoint(event.target.value);
                rebuildSegments(event.target.value, endPoint, stops);
              }}
            />
          </Field>
          <Field label="Endpunkt">
            <Input
              name="end_point"
              value={endPoint}
              onChange={(event) => {
                setEndPoint(event.target.value);
                rebuildSegments(startPoint, event.target.value, stops);
              }}
            />
          </Field>
          <Field label="Startdatum + Startzeit">
            <Input
              name="start_at"
              type="datetime-local"
              required
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </Field>
          <Field label="Rückkehrdatum + Rückkehrzeit">
            <Input
              name="end_at"
              type="datetime-local"
              required
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-medium text-slate-950">Zwischenstopps</h3>
              <p className="text-sm text-slate-600">
                Erfasse pro Stopp Land, Zeitraum, Zweck und bereitgestellte Mahlzeiten.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={addStop} className="w-full sm:w-auto">
              Stopp hinzufügen
            </Button>
          </div>

          <div className="space-y-4">
            {stops.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                Noch keine Zwischenstopps. Start und Rückkehr bleiben trotzdem sichtbar.
              </div>
            ) : null}
            {stops.map((stop, index) => (
              <Card key={stop.id} className="space-y-4 bg-slate-50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-950">Stopp {index + 1}</p>
                  <Button type="button" variant="ghost" onClick={() => removeStop(stop.id)}>
                    Entfernen
                  </Button>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label={`Ort Stopp ${index + 1}`}>
                    <Input
                      value={stop.location}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].location = event.target.value;
                        setStops(next);
                        rebuildSegments(startPoint, endPoint, next);
                      }}
                    />
                  </Field>
                  <Field label="Land">
                    <Input
                      value={stop.country}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].country = event.target.value;
                        setStops(next);
                      }}
                    />
                  </Field>
                  <Field label="Ankunft an diesem Ort (Datum + Uhrzeit)">
                    <Input
                      type="datetime-local"
                      value={stop.arrival_at}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].arrival_at = event.target.value;
                        setStops(next);
                      }}
                    />
                  </Field>
                  <Field label="Abfahrt von diesem Ort (Datum + Uhrzeit)">
                    <Input
                      type="datetime-local"
                      value={stop.departure_at}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].departure_at = event.target.value;
                        setStops(next);
                      }}
                    />
                  </Field>
                  <Field label="Zweck">
                    <Select
                      value={stop.purpose}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].purpose = event.target.value as TripPurpose;
                        setStops(next);
                        rebuildSegments(startPoint, endPoint, next);
                      }}
                    >
                      {tripPurposeOptions.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {purpose}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Notiz zum Stopp">
                    <Input
                      value={stop.note}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].note = event.target.value;
                        setStops(next);
                      }}
                    />
                  </Field>
                  <Field label="Frühstück gestellt?">
                    <Select
                      value={stop.breakfast_provided ? "true" : "false"}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].breakfast_provided = event.target.value === "true";
                        setStops(next);
                      }}
                    >
                      <option value="false">Nein</option>
                      <option value="true">Ja</option>
                    </Select>
                  </Field>
                  <Field label="Mittagessen gestellt?">
                    <Select
                      value={stop.lunch_provided ? "true" : "false"}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].lunch_provided = event.target.value === "true";
                        setStops(next);
                      }}
                    >
                      <option value="false">Nein</option>
                      <option value="true">Ja</option>
                    </Select>
                  </Field>
                  <Field label="Abendessen gestellt?">
                    <Select
                      value={stop.dinner_provided ? "true" : "false"}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].dinner_provided = event.target.value === "true";
                        setStops(next);
                      }}
                    >
                      <option value="false">Nein</option>
                      <option value="true">Ja</option>
                    </Select>
                  </Field>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-slate-950">Fahrsegmente und Kilometer</h3>
            <p className="text-sm text-slate-600">
              Der Rückweg zum Endpunkt bleibt immer sichtbar und wird separat erfasst.
            </p>
          </div>
          <div className="grid gap-4">
            {segments.map((segment, index) => (
              <Card key={segment.id} className="grid gap-4 bg-slate-50 lg:grid-cols-[1fr_180px]">
                <div>
                  <p className="text-sm font-medium text-slate-950">
                    {segment.from_label} {"->"} {segment.to_label}
                  </p>
                  <p className="text-xs text-slate-500">Segment {index + 1}</p>
                </div>
                <Input
                  type="number"
                  step="0.1"
                  value={segment.kilometers}
                  onChange={(event) => {
                    const next = [...segments];
                    next[index].kilometers = Number(event.target.value);
                    setSegments(next);
                  }}
                />
              </Card>
            ))}
          </div>
          <Card className="grid gap-2 bg-slate-950 text-white">
            <p className="text-sm text-slate-300">Fahrtkostenformel</p>
            <p className="text-xl font-semibold">
              {totals.totalKm.toFixed(1)} km x 0,30 ={" "}
              {formatCurrency(totals.drivingDeduction, reportingCurrency)}
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-slate-950">Verpflegungspauschalen pro Tag</h3>
            <p className="text-sm text-slate-600">
              Die Berechnung berücksichtigt Zeitfenster, Land um 24:00 Uhr, private Stopps und
              Mahlzeitenkürzungen.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tag</th>
                  <th className="px-4 py-3">Land</th>
                  <th className="px-4 py-3">Abwesenheit</th>
                  <th className="px-4 py-3">Tagesart</th>
                  <th className="px-4 py-3">Pauschale</th>
                  <th className="px-4 py-3">Mahlzeitenkürzung</th>
                  <th className="px-4 py-3">Ansetzbar</th>
                  <th className="px-4 py-3">Begründung</th>
                </tr>
              </thead>
              <tbody>
                {perDiemPreview.breakdown.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={8}>
                      Noch keine Tagesberechnung verfügbar. Trage Start, Ende und Stopps ein.
                    </td>
                  </tr>
                ) : (
                  perDiemPreview.breakdown.map((day) => (
                    <tr key={day.date} className="border-t border-line">
                      <td className="px-4 py-3">{day.date}</td>
                      <td className="px-4 py-3">{day.country}</td>
                      <td className="px-4 py-3">{day.absence_hours.toFixed(1)} h</td>
                      <td className="px-4 py-3">{day.day_type}</td>
                      <td className="px-4 py-3">
                        {formatCurrency(day.base_amount, reportingCurrency)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(day.meal_reduction, reportingCurrency)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(day.deductible_amount, reportingCurrency)}
                      </td>
                      <td className="px-4 py-3">{day.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4 rounded-2xl border border-line bg-slate-50 p-4 lg:grid-cols-2">
          <Field label="Kann an Kunden weiterberechnet werden?">
            <Select
              name="reimbursable_to_client"
              value={reimbursableToClient}
              onChange={(event) => setReimbursableToClient(event.target.value)}
            >
              <option value="false">Nein</option>
              <option value="true">Ja</option>
            </Select>
          </Field>
          <Field label="Weiterberechenbarer Betrag">
            <Input
              name="reimbursement_amount_original"
              type="number"
              step="0.01"
              value={reimbursementAmount}
              onChange={(event) => setReimbursementAmount(event.target.value)}
              disabled={reimbursableToClient !== "true"}
            />
          </Field>
          <Field label="Währung des weiterberechenbaren Betrags">
            <Select
              name="reimbursement_currency"
              value={reimbursementCurrency}
              onChange={(event) => setReimbursementCurrency(event.target.value as CurrencyCode)}
              disabled={reimbursableToClient !== "true"}
            >
              <option value="EUR">EUR</option>
              <option value="CHF">CHF</option>
            </Select>
          </Field>
          <div className="lg:col-span-2">
            <ExchangeRateInput
              dateName="start_at"
              fallbackRate={fallbackRate}
              defaultRate={reimbursementRate}
              rateName="reimbursement_exchange_rate"
              manualName="reimbursement_exchange_rate_manual"
              label="Wechselkurs für weiterberechenbare Kosten"
              hint="Nur relevant, wenn du weiterberechenbare Kosten in Fremdwährung erfasst."
            />
          </div>
        </div>

        <Field label="Notiz">
          <Textarea
            name="note"
            placeholder="Optional: Hinweise zu privatem Anteil, Reiseverlauf oder offenen Belegen."
            defaultValue={initialTrip?.note ?? ""}
          />
        </Field>

        <input name="stops_json" type="hidden" value={JSON.stringify(stops)} />
        <input name="segments_json" type="hidden" value={JSON.stringify(segments)} />

        <FormFeedback error={error} success={success} />

        <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
          {isEditing ? (
            <Link href="/fahrten-reisen">
              <Button type="button" variant="secondary" className="w-full sm:w-auto">Bearbeitung verlassen</Button>
            </Link>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Speichern..." : isEditing ? "Reise aktualisieren" : "Reise speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
