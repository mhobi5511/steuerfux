"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTripTemplate, updateTripTemplate, upsertTrip } from "@/app/actions/finance";
import { ExchangeRateInput } from "@/components/forms/exchange-rate-input";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { homeAddressDefault, tripPurposeOptions } from "@/lib/constants";
import { basePerDiemRates } from "@/lib/per-diem";
import type {
  Buchhaltung,
  BusinessCountry,
  CurrencyCode,
  MileageYearSetting,
  Reimbursement,
  ReportingCurrency,
  Trip,
  TripTemplate,
  TripPurpose
} from "@/lib/db-types";
import { buildPerDiemBreakdown, calculateTripTotals } from "@/lib/trips";
import {
  getMileageConfiguration,
  getYearFromDate,
  preferTripMileageSnapshot
} from "@/lib/mileage";
import { templateToPreset, type TripTemplatePreset } from "@/lib/trip-templates";
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

const countryOptions = basePerDiemRates.map((rate) => rate.country);

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

function mapTripToSegments(
  trip: Trip | null | undefined,
  homeAddress: string
): Segment[] {
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

function mapPresetToStops(preset?: TripTemplatePreset | null): Stop[] {
  return (preset?.stops ?? []).map((stop) => ({
    id: crypto.randomUUID(),
    ...stop,
    arrival_at: "",
    departure_at: "",
    breakfast_provided: false,
    lunch_provided: false,
    dinner_provided: false,
    note: ""
  }));
}

function mapPresetToSegments(
  preset: TripTemplatePreset | null | undefined,
  homeAddress: string
): Segment[] {
  if (!preset?.segments.length) return buildDefaultSegments(preset?.start_point ?? homeAddress);
  return preset.segments.map((segment) => ({ id: crypto.randomUUID(), ...segment }));
}

export function TripForm({
  homeAddress = homeAddressDefault,
  businessCountry,
  reportingCurrency,
  defaultCurrency,
  fallbackRate,
  activeBuchhaltung,
  mileageSettings,
  defaultYear,
  templates,
  initialTrip = null,
  duplicatePreset = null,
  initialReimbursement = null
}: {
  homeAddress?: string;
  businessCountry: BusinessCountry;
  reportingCurrency: ReportingCurrency;
  defaultCurrency: CurrencyCode;
  fallbackRate: number;
  activeBuchhaltung: Buchhaltung | null;
  mileageSettings: MileageYearSetting[];
  defaultYear: number;
  templates: TripTemplate[];
  initialTrip?: Trip | null;
  duplicatePreset?: TripTemplatePreset | null;
  initialReimbursement?: Reimbursement | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [templatePending, startTemplateTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDuplicate = Boolean(!initialTrip && duplicatePreset);
  const [showDuplicateNotice, setShowDuplicateNotice] = useState(isDuplicate);
  const [title, setTitle] = useState(initialTrip?.title ?? duplicatePreset?.title ?? "");
  const [businessReason, setBusinessReason] = useState(
    initialTrip?.business_reason ?? duplicatePreset?.business_reason ?? ""
  );
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(initialTrip?.start_at));
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(initialTrip?.end_at));
  const [stops, setStops] = useState<Stop[]>(() =>
    initialTrip ? mapTripToStops(initialTrip) : mapPresetToStops(duplicatePreset)
  );
  const [expandedStopIds, setExpandedStopIds] = useState<Set<string>>(() => new Set());
  const [startPoint, setStartPoint] = useState(
    initialTrip?.start_point ?? duplicatePreset?.start_point ?? homeAddress
  );
  const [endPoint, setEndPoint] = useState(
    initialTrip?.end_point ?? duplicatePreset?.end_point ?? homeAddress
  );
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
    initialTrip
      ? mapTripToSegments(initialTrip, homeAddress)
      : mapPresetToSegments(duplicatePreset, homeAddress)
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [calculatingSegmentId, setCalculatingSegmentId] = useState<string | null>(null);
  const [distanceError, setDistanceError] = useState<string | null>(null);

  const isEditing = Boolean(initialTrip?.id);

  const mileagePreview = useMemo(() => {
    if (!activeBuchhaltung) return null;
    const year = getYearFromDate(startAt) ?? defaultYear;
    const configured = getMileageConfiguration({
      buchhaltung: activeBuchhaltung,
      year,
      settings: mileageSettings
    });
    const oldBusinessKm = (initialTrip?.trip_segments ?? []).reduce(
      (sum, segment) => sum + (segment.is_business ? segment.kilometers : 0),
      0
    );
    const legacyRate =
      initialTrip && initialTrip.applied_mileage_rate == null && oldBusinessKm > 0
        ? initialTrip.driving_deduction_reporting / oldBusinessKm
        : undefined;

    return preferTripMileageSnapshot({
      configured,
      appliedRate: initialTrip?.applied_mileage_rate ?? legacyRate,
      appliedCurrency:
        initialTrip?.applied_mileage_currency ??
        (legacyRate === undefined ? undefined : initialTrip?.reporting_currency)
    });
  }, [activeBuchhaltung, defaultYear, initialTrip, mileageSettings, startAt]);
  const mileageTotals = useMemo(
    () => calculateTripTotals(segments, mileagePreview?.rate ?? 0),
    [mileagePreview?.rate, segments]
  );
  const startYear = getYearFromDate(startAt);
  const endYear = getYearFromDate(endAt);
  const crossesYear = Boolean(startYear && endYear && startYear !== endYear);

  useEffect(() => {
    const nextIsDuplicate = Boolean(!initialTrip && duplicatePreset);
    setTitle(initialTrip?.title ?? duplicatePreset?.title ?? "");
    setBusinessReason(initialTrip?.business_reason ?? duplicatePreset?.business_reason ?? "");
    setShowDuplicateNotice(nextIsDuplicate);
    setStartAt(toDateTimeLocalValue(initialTrip?.start_at));
    setEndAt(toDateTimeLocalValue(initialTrip?.end_at));
    const nextStops = initialTrip
      ? mapTripToStops(initialTrip)
      : mapPresetToStops(duplicatePreset);
    setStops(nextStops);
    setExpandedStopIds(new Set(nextIsDuplicate ? nextStops.map((stop) => stop.id) : []));
    setStartPoint(initialTrip?.start_point ?? duplicatePreset?.start_point ?? homeAddress);
    setEndPoint(initialTrip?.end_point ?? duplicatePreset?.end_point ?? homeAddress);
    setReimbursableToClient(initialTrip?.reimbursable_to_client ? "true" : "false");
    setReimbursementAmount(
      initialReimbursement?.original_amount ? String(initialReimbursement.original_amount) : ""
    );
    setReimbursementCurrency(initialReimbursement?.currency ?? defaultCurrency);
    setReimbursementRate(initialReimbursement?.exchange_rate ?? 1);
    setSegments(
      initialTrip
        ? mapTripToSegments(initialTrip, homeAddress)
        : mapPresetToSegments(duplicatePreset, homeAddress)
    );
    setActiveTemplateId(null);
    setSuccess(null);
    setError(null);
  }, [defaultCurrency, duplicatePreset, homeAddress, initialReimbursement, initialTrip]);

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
    const id = crypto.randomUUID();
    const nextStops = [
      ...stops,
      {
        id,
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
    setExpandedStopIds((current) => new Set(current).add(id));
    rebuildSegments(startPoint, endPoint, nextStops);
  }

  function removeStop(id: string) {
    const nextStops = stops.filter((stop) => stop.id !== id);
    setStops(nextStops);
    setExpandedStopIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    rebuildSegments(startPoint, endPoint, nextStops);
  }

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
    setTitle("");
    setBusinessReason("");
    setShowDuplicateNotice(false);
    setStops([]);
    setExpandedStopIds(new Set());
    setStartPoint(homeAddress);
    setEndPoint(homeAddress);
    setReimbursableToClient("false");
    setReimbursementAmount("");
    setReimbursementCurrency(defaultCurrency);
    setReimbursementRate(1);
    setSegments(buildDefaultSegments(homeAddress));
    setActiveTemplateId(null);
  }

  function applyTemplate(template: TripTemplate) {
    const preset = templateToPreset(template);
    const nextStops = mapPresetToStops(preset);
    setTitle(preset.title);
    setBusinessReason(preset.business_reason);
    setStartPoint(preset.start_point);
    setEndPoint(preset.end_point);
    setStops(nextStops);
    setSegments(mapPresetToSegments(preset, homeAddress));
    setExpandedStopIds(new Set(nextStops.map((stop) => stop.id)));
    setActiveTemplateId(template.id);
    setError(null);
    setSuccess(`Vorlage „${template.name}“ übernommen. Datum und Zeiten bitte ergänzen.`);
  }

  function getCurrentTemplatePreset(): TripTemplatePreset {
    return {
      title,
      business_reason: businessReason,
      start_point: startPoint,
      end_point: endPoint,
      stops: stops.map((stop) => ({
        location: stop.location,
        country: stop.country,
        purpose: stop.purpose
      })),
      segments: segments.map((segment) => ({
        from_label: segment.from_label,
        to_label: segment.to_label,
        kilometers: segment.kilometers,
        is_business: segment.is_business
      }))
    };
  }

  function updateActiveTemplate() {
    const template = templates.find((item) => item.id === activeTemplateId);
    if (!template) return;
    startTemplateTransition(async () => {
      setError(null);
      setSuccess(null);
      const formData = new FormData();
      formData.set("template_id", template.id);
      formData.set("name", template.name);
      formData.set("preset_json", JSON.stringify(getCurrentTemplatePreset()));
      const result = await updateTripTemplate(formData);
      if (result.error) setError(result.error);
      if (result.success) {
        setSuccess(result.success);
        router.refresh();
      }
    });
  }

  function removeActiveTemplate() {
    const template = templates.find((item) => item.id === activeTemplateId);
    if (!template || !confirm(`Vorlage „${template.name}“ löschen?`)) return;
    startTemplateTransition(async () => {
      setError(null);
      setSuccess(null);
      const formData = new FormData();
      formData.set("template_id", template.id);
      const result = await deleteTripTemplate(formData);
      if (result.error) setError(result.error);
      if (result.success) {
        setActiveTemplateId(null);
        setSuccess(result.success);
        router.refresh();
      }
    });
  }

  async function calculateSegmentDistance(index: number) {
    const segment = segments[index];
    if (!segment) return;

    setDistanceError(null);
    setCalculatingSegmentId(segment.id);

    try {
      const response = await fetch("/api/maps/distance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          origin: segment.from_label,
          destination: segment.to_label
        })
      });
      const result = (await response.json()) as { kilometers?: number; error?: string };

      if (!response.ok || typeof result.kilometers !== "number") {
        setDistanceError(result.error ?? "Kilometer konnten nicht berechnet werden.");
        return;
      }

      setSegments((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, kilometers: result.kilometers ?? 0 } : item
        )
      );
    } catch {
      setDistanceError("Kilometer konnten nicht berechnet werden.");
    } finally {
      setCalculatingSegmentId(null);
    }
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">
          {isEditing ? "Reise bearbeiten" : "Neue Fahrt / Reise"}
        </h2>
        <p className="hidden text-sm leading-6 text-slate-600">
          Trage deine Reise Schritt für Schritt ein: Start {">"} alle Zwischenstopps {">"} Rückkehr.
          Die Verpflegungspauschalen werden pro Kalendertag mit Land, Abwesenheit und
          Mahlzeitenkürzung aufgeschlüsselt.
        </p>
      </div>

      {!isEditing ? (
        <section className="space-y-3 rounded-2xl border border-line bg-white p-4 dark:bg-slate-950">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Häufige Fahrten
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Route auswählen, Datum und Zeiten ergänzen, prüfen und speichern.
            </p>
          </div>
          {templates.length ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {templates.slice(0, 3).map((template) => {
                  const kilometers = template.segments.reduce(
                    (sum, segment) => sum + segment.kilometers,
                    0
                  );
                  const destination = template.stops.at(-1)?.location ?? template.end_point;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="min-h-16 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      <span className="block font-medium text-slate-950">{template.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {template.start_point} → {destination} · {kilometers.toFixed(1)} km
                      </span>
                      <span className="mt-2 block text-xs font-medium text-brand-700 dark:text-brand-300">
                        Fahrt erfassen
                      </span>
                    </button>
                  );
                })}
              </div>
              <Field label="Häufige Fahrt verwenden">
                <Select
                  value=""
                  onChange={(event) => {
                    const template = templates.find((item) => item.id === event.target.value);
                    if (template) applyTemplate(template);
                  }}
                >
                  <option value="">Vorlage auswählen</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {activeTemplateId ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={templatePending}
                    onClick={updateActiveTemplate}
                  >
                    Vorlage mit aktueller Route aktualisieren
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={templatePending}
                    onClick={removeActiveTemplate}
                  >
                    Vorlage löschen
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Noch keine Vorlagen. Speichere eine vorhandene Fahrt über „Als Vorlage speichern“.
            </p>
          )}
        </section>
      ) : null}

      {showDuplicateNotice ? (
        <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          Wiederverwendbare Routendaten wurden übernommen. Dies ist eine neue, noch nicht
          gespeicherte Fahrt; Datum, Zeiten und Kilometersatz werden neu bestimmt.
        </p>
      ) : null}

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

        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Basisdaten
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Reisebezeichnung">
            <Input
              name="title"
              required
              placeholder="z. B. LED Drumshow Schweiz"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Geschäftlicher Anlass">
            <Input
              name="business_reason"
              placeholder="z. B. Probe, Auftritt, Meeting"
              value={businessReason}
              onChange={(event) => setBusinessReason(event.target.value)}
            />
          </Field>
          <div>
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
          </div>
          <div>
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
          </div>
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
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Route &amp; Zwischenstopps
              </h3>
              <p className="hidden text-sm text-slate-600">
                Erfasse pro Stopp Land, Zeitraum, Zweck und bereitgestellte Mahlzeiten.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={addStop} className="w-full sm:w-auto">
              Stopp hinzufügen
            </Button>
          </div>

          <div className="space-y-4">
            {stops.length === 0 ? (
              <div className="hidden rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                Noch keine Zwischenstopps. Start und Rückkehr bleiben trotzdem sichtbar.
              </div>
            ) : null}
            {stops.map((stop, index) => (
              <details
                key={stop.id}
                open={expandedStopIds.has(stop.id)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  setExpandedStopIds((current) => {
                    const next = new Set(current);
                    if (isOpen) next.add(stop.id);
                    else next.delete(stop.id);
                    return next;
                  });
                }}
                className="rounded-2xl border border-line bg-slate-50 p-4 dark:bg-slate-900"
              >
                <summary className="cursor-pointer text-sm font-medium text-slate-950">
                  Stopp {index + 1}: {stop.location || "Ort fehlt"}
                  {stop.country ? ` · ${stop.country}` : ""} · {stop.purpose}
                </summary>
                <div className="mt-3 flex justify-end">
                  <Button type="button" variant="ghost" onClick={() => removeStop(stop.id)}>
                    Entfernen
                  </Button>
                </div>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
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
                    <Select
                      value={stop.country}
                      onChange={(event) => {
                        const next = [...stops];
                        next[index].country = event.target.value;
                        setStops(next);
                      }}
                    >
                      <option value="">Bitte wählen</option>
                      {countryOptions.map((country) => (
                        <option key={country} value={country}>
                          {country}
                        </option>
                      ))}
                    </Select>
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
                  <details className="rounded-2xl border border-line bg-slate-50 p-4 dark:bg-slate-900 lg:col-span-2">
                    <summary className="cursor-pointer text-sm font-medium text-slate-900">
                      Mahlzeiten
                    </summary>
                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
                  </details>
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Kilometer
            </h3>
            <p className="hidden text-sm text-slate-600">
              Der Rückweg zum Endpunkt bleibt immer sichtbar und wird separat erfasst.
            </p>
          </div>
          <div className="grid gap-4">
            {segments.map((segment, index) => (
              <Card
                key={segment.id}
                className="grid min-w-0 gap-4 bg-slate-50 dark:bg-slate-900 lg:grid-cols-[1fr_180px_180px]"
              >
                <div>
                  <p className="text-sm font-medium text-slate-950">
                    {segment.from_label} {"->"} {segment.to_label}
                  </p>
                  <p className="text-xs text-slate-500">Segment {index + 1}</p>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={segment.kilometers}
                  onChange={(event) => {
                    const next = [...segments];
                    next[index].kilometers = Number(event.target.value);
                    setSegments(next);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => calculateSegmentDistance(index)}
                  disabled={
                    calculatingSegmentId === segment.id ||
                    !segment.from_label.trim() ||
                    !segment.to_label.trim()
                  }
                  className="w-full"
                >
                  {calculatingSegmentId === segment.id ? "Berechne..." : "Km berechnen"}
                </Button>
              </Card>
            ))}
          </div>
          {distanceError ? <p className="text-sm text-rose-600">{distanceError}</p> : null}
          <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-3 dark:bg-slate-950">
            <div>
              <p className="text-xs text-slate-500">Geschäftliche Strecke</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {mileageTotals.businessKm.toFixed(1)} km
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Kilometersatz</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {mileagePreview
                  ? `${mileagePreview.currency} ${mileagePreview.rate.toFixed(2)} / km`
                  : "Nicht konfiguriert"}
              </p>
              <Link
                href="/einstellungen#kilometersatz"
                className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
              >
                Kilometersatz ändern
              </Link>
            </div>
            <div>
              <p className="text-xs text-slate-500">Abziehbarer Fahrtaufwand</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(
                  mileageTotals.drivingDeduction,
                  mileagePreview?.currency ?? reportingCurrency
                )}
              </p>
            </div>
          </div>
          {!mileagePreview ? (
            <p className="text-sm text-amber-700">
              Für dieses Abrechnungsjahr fehlt ein gültiger Kilometersatz. Bitte hinterlege ihn
              vor dem Speichern in den Einstellungen.
            </p>
          ) : null}
          {crossesYear ? (
            <p className="text-sm text-amber-700">
              Die Reise überschreitet den Jahreswechsel. Bitte als zwei Reisen erfassen, damit
              die jährlichen Kilometersätze korrekt angewendet werden.
            </p>
          ) : null}
        </div>

        <details className="rounded-2xl border border-line bg-slate-50 p-4 dark:bg-slate-900">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            Verpflegung
          </summary>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
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
                      Noch keine Tagesberechnung verfügbar.
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
        </details>

        <details className="rounded-2xl border border-line bg-slate-50 p-4 dark:bg-slate-900">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            Weitere Optionen
          </summary>
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
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
              />
            </div>
            <div className="lg:col-span-2">
              <Field label="Notiz">
                <Textarea
                  name="note"
                  placeholder="Optional: Hinweise zu privatem Anteil, Reiseverlauf oder offenen Belegen."
                  defaultValue={initialTrip?.note ?? ""}
                />
              </Field>
            </div>
          </div>
        </details>

        <input name="stops_json" type="hidden" value={JSON.stringify(stops)} />
        <input name="segments_json" type="hidden" value={JSON.stringify(segments)} />

        <FormFeedback error={error} success={success} />

        <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
          {isEditing ? (
            <Link href="/fahrten-reisen">
              <Button type="button" variant="secondary" className="w-full sm:w-auto">Bearbeitung verlassen</Button>
            </Link>
          ) : null}
          <Button
            type="submit"
            disabled={pending || !mileagePreview || crossesYear}
            className="w-full sm:w-auto"
          >
            {pending ? "Speichern..." : isEditing ? "Reise aktualisieren" : "Reise speichern"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
