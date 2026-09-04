import type { Trip, TripTemplate } from "@/lib/db-types";

export type TripTemplatePreset = Pick<
  TripTemplate,
  "title" | "business_reason" | "start_point" | "end_point" | "stops" | "segments"
>;

export function createTripTemplatePreset(
  trip: Pick<
    Trip,
    | "title"
    | "business_reason"
    | "start_point"
    | "end_point"
    | "trip_stops"
    | "trip_segments"
  >
): TripTemplatePreset {
  return {
    title: trip.title,
    business_reason: trip.business_reason,
    start_point: trip.start_point,
    end_point: trip.end_point,
    stops: [...(trip.trip_stops ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((stop) => ({
        location: stop.location,
        country: stop.country,
        purpose: stop.purpose
      })),
    segments: [...(trip.trip_segments ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((segment) => ({
        from_label: segment.from_label,
        to_label: segment.to_label,
        kilometers: segment.kilometers,
        is_business: segment.is_business
      }))
  };
}

export function templateToPreset(
  template: Pick<
    TripTemplate,
    "title" | "business_reason" | "start_point" | "end_point" | "stops" | "segments"
  >
): TripTemplatePreset {
  return {
    title: template.title,
    business_reason: template.business_reason,
    start_point: template.start_point,
    end_point: template.end_point,
    stops: template.stops.map((stop) => ({ ...stop })),
    segments: template.segments.map((segment) => ({ ...segment }))
  };
}
