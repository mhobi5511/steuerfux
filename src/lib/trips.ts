import { calculatePerDiemForDay } from "@/lib/per-diem";
import { roundMoney } from "@/lib/currency";
import type { BusinessCountry, CurrencyCode, PerDiemBreakdownRow, ReportingCurrency, TripPurpose } from "@/lib/db-types";

export type EditableTripStop = {
  id: string;
  location: string;
  country: string;
  arrival_at: string;
  departure_at: string;
  purpose: TripPurpose;
  breakfast_provided?: boolean;
  lunch_provided?: boolean;
  dinner_provided?: boolean;
  note?: string | null;
};

export type EditableTripSegment = {
  id: string;
  from_label: string;
  to_label: string;
  kilometers: number;
  is_business?: boolean;
};

export const kilometerRate = 0.3;

export function isBusinessPurpose(purpose: TripPurpose) {
  return purpose !== "Privat";
}

export function calculateDrivingDeduction(totalKm: number) {
  return roundMoney(totalKm * kilometerRate);
}

export function calculateTripTotals(segments: EditableTripSegment[]) {
  const totalKm = segments.reduce((sum, segment) => sum + (segment.kilometers || 0), 0);
  return {
    totalKm: roundMoney(totalKm),
    drivingDeduction: calculateDrivingDeduction(totalKm)
  };
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60));
}

function activeStopAt(stops: EditableTripStop[], pointInTime: Date) {
  return stops.find((stop) => {
    const arrival = new Date(stop.arrival_at);
    const departure = new Date(stop.departure_at);
    return arrival <= pointInTime && departure >= pointInTime;
  });
}

function activeBusinessStopsForDay(stops: EditableTripStop[], dayStart: Date, dayEnd: Date) {
  return stops.filter((stop) => {
    const arrival = new Date(stop.arrival_at);
    const departure = new Date(stop.departure_at);
    const overlaps = arrival <= dayEnd && departure >= dayStart;
    return overlaps && isBusinessPurpose(stop.purpose);
  });
}

export function buildPerDiemBreakdown({
  startAt,
  endAt,
  stops,
  businessCountry
}: {
  startAt: string;
  endAt: string;
  stops: EditableTripStop[];
  businessCountry: BusinessCountry;
}) {
  if (!startAt || !endAt) return { breakdown: [] as PerDiemBreakdownRow[], total: 0 };

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { breakdown: [] as PerDiemBreakdownRow[], total: 0 };
  }

  const sortedStops = [...stops].sort(
    (left, right) => new Date(left.arrival_at).getTime() - new Date(right.arrival_at).getTime()
  );

  const days: PerDiemBreakdownRow[] = [];
  const cursor = startOfDay(start);
  const finalDay = startOfDay(end);

  while (cursor <= finalDay) {
    const dayStart = startOfDay(cursor);
    const dayEnd = endOfDay(cursor);
    const effectiveStart = start > dayStart ? start : dayStart;
    const effectiveEnd = end < dayEnd ? end : dayEnd;
    const absenceHours = roundMoney(hoursBetween(effectiveStart, effectiveEnd));
    const midnight = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1000);
    const midnightStop = activeStopAt(sortedStops, midnight);
    const businessStops = activeBusinessStopsForDay(sortedStops, dayStart, dayEnd);
    const hasPrivateStop = sortedStops.some((stop) => {
      const arrival = new Date(stop.arrival_at);
      const departure = new Date(stop.departure_at);
      return arrival <= dayEnd && departure >= dayStart && stop.purpose === "Privat";
    });

    const country =
      midnightStop?.country ||
      businessStops[0]?.country ||
      (businessCountry === "Schweiz" ? "Schweiz" : "Deutschland");
    const isArrivalDay = dateKey(cursor) === dateKey(start);
    const isDepartureDay = dateKey(cursor) === dateKey(end);
    const businessRelevant = businessStops.length > 0 || (isArrivalDay || isDepartureDay);

    if (businessRelevant) {
      const mealsStop = midnightStop ?? businessStops[0];
      const dayType = isArrivalDay
        ? "Anreisetag"
        : isDepartureDay
          ? "Abreisetag"
          : absenceHours >= 24
            ? "Voller Reisetag"
            : "Teilreisetag";

      const perDiem = calculatePerDiemForDay({
        date: dateKey(cursor),
        countryAtMidnight: country,
        absenceHours,
        breakfastProvided: Boolean(mealsStop?.breakfast_provided),
        lunchProvided: Boolean(mealsStop?.lunch_provided),
        dinnerProvided: Boolean(mealsStop?.dinner_provided),
        isArrivalDay,
        isDepartureDay
      });

      const reasonParts = [
        `${dayType} mit ${absenceHours.toFixed(1)} Stunden Abwesenheit.`,
        hasPrivateStop ? "Privater Anteil vorhanden, bitte prüfen." : "Geschäftlicher Reisetag."
      ];

      days.push({
        date: dateKey(cursor),
        country: perDiem.country,
        absence_hours: absenceHours,
        day_type: dayType,
        base_amount: perDiem.baseAmount,
        meal_reduction: perDiem.reductionAmount,
        deductible_amount: perDiem.deductibleAmount,
        reason: reasonParts.join(" "),
        private_portion_flag: hasPrivateStop
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    breakdown: days,
    total: roundMoney(days.reduce((sum, day) => sum + day.deductible_amount, 0))
  };
}

export function validateTripChronology(startAt: string, endAt: string, stops: EditableTripStop[]) {
  const errors: string[] = [];

  if (!startAt) errors.push("Startdatum und Startzeit fehlen.");
  if (!endAt) errors.push("Rückkehrdatum und Rückkehrzeit fehlen.");
  if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
    errors.push("Die Rückkehr muss nach dem Start liegen.");
  }

  let lastTime = startAt;
  for (const stop of stops) {
    if (!stop.country || !stop.arrival_at || !stop.departure_at) {
      errors.push(`Beim Stopp "${stop.location || "ohne Ort"}" fehlen Pflichtfelder.`);
      continue;
    }
    if (new Date(stop.arrival_at) > new Date(stop.departure_at)) {
      errors.push(`Beim Stopp "${stop.location}" liegt die Abfahrt vor der Ankunft.`);
    }
    if (lastTime && new Date(lastTime) > new Date(stop.arrival_at)) {
      errors.push(`Die Zeiten bei "${stop.location}" sind nicht chronologisch.`);
    }
    lastTime = stop.departure_at;
  }

  if (lastTime && endAt && new Date(lastTime) > new Date(endAt)) {
    errors.push("Die letzte Abfahrt liegt nach der Rückkehr.");
  }

  return errors;
}
