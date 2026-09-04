import assert from "node:assert/strict";
import test from "node:test";
import { convertToReportingCurrency } from "@/lib/currency";
import { isDepreciationActiveInYear } from "@/lib/depreciation";
import { calculateDueDate, calculateInvoiceItem } from "@/lib/invoice-utils";
import { calculatePerDiemForDay } from "@/lib/per-diem";
import { calculateTripTotals } from "@/lib/trips";
import { createTripTemplatePreset } from "@/lib/trip-templates";
import type { Trip } from "@/lib/db-types";
import {
  getMileageConfiguration,
  preferTripMileageSnapshot
} from "@/lib/mileage";
import { escapeHtml } from "@/lib/utils";

test("currency conversion follows the stored CHF/EUR quotation", () => {
  assert.equal(convertToReportingCurrency(100, "CHF", "EUR", 0.95), 95);
  assert.equal(convertToReportingCurrency(100, "EUR", "CHF", 0.8), 125);
  assert.equal(convertToReportingCurrency(12.345, "EUR", "EUR", 0.95), 12.35);
});

test("invoice line totals use integer cents and a rounded VAT amount", () => {
  assert.deepEqual(
    calculateInvoiceItem({
      title: "Leistung",
      quantity: 1.5,
      unitPrice: 19.99,
      currency: "EUR",
      vatRate: 8.1
    }),
    {
      unitPriceCents: 1999,
      netAmountCents: 2999,
      vatAmountCents: 243,
      grossAmountCents: 3242
    }
  );
});

test("one-month payment terms clamp end-of-month dates", () => {
  assert.equal(calculateDueDate("2026-01-31", "1 Monat"), "2026-02-28");
  assert.equal(calculateDueDate("2028-01-31", "1 Monat"), "2028-02-29");
  assert.equal(calculateDueDate("2026-12-28", "7 Tage"), "2027-01-04");
  assert.equal(
    calculateDueDate("2026-01-31", "benutzerdefiniert", "2026-03-15"),
    "2026-03-15"
  );
});

test("private trip segments remain visible but are not deductible", () => {
  assert.deepEqual(
    calculateTripTotals([
      { id: "business", from_label: "A", to_label: "B", kilometers: 100 },
      { id: "private", from_label: "B", to_label: "C", kilometers: 50, is_business: false }
    ]),
    { totalKm: 150, businessKm: 100, drivingDeduction: 30 }
  );
});

test("Swiss 2026 mileage uses CHF 0.75 per business kilometer", () => {
  assert.deepEqual(
    calculateTripTotals(
      [{ id: "business", from_label: "A", to_label: "B", kilometers: 100 }],
      0.75
    ),
    { totalKm: 100, businessKm: 100, drivingDeduction: 75 }
  );
});

test("German mileage keeps the existing EUR 0.30 default", () => {
  assert.equal(
    calculateTripTotals([
      { id: "business", from_label: "A", to_label: "B", kilometers: 100 }
    ]).drivingDeduction,
    30
  );
});

test("yearly mileage settings remain isolated by Buchhaltung", () => {
  const settings = [
    {
      id: "ch-setting",
      user_id: "user",
      buchhaltung_id: "ch-book",
      year: 2026,
      mileage_rate: 0.8,
      mileage_currency: "CHF" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01"
    }
  ];
  const german = getMileageConfiguration({
    buchhaltung: {
      id: "de-book",
      country: "Deutschland",
      reporting_currency: "EUR"
    },
    year: 2026,
    settings
  });
  const swiss = getMileageConfiguration({
    buchhaltung: { id: "ch-book", country: "Schweiz", reporting_currency: "CHF" },
    year: 2026,
    settings
  });

  assert.equal(german?.rate, 0.3);
  assert.equal(german?.currency, "EUR");
  assert.equal(swiss?.rate, 0.8);
  assert.equal(swiss?.currency, "CHF");
});

test("a saved trip snapshot wins over a later yearly setting change", () => {
  const changedYearSetting = {
    year: 2026,
    rate: 0.9,
    currency: "CHF" as const,
    source: "saved" as const
  };
  const historical = preferTripMileageSnapshot({
    configured: changedYearSetting,
    appliedRate: 0.75,
    appliedCurrency: "CHF"
  });

  assert.equal(historical?.rate, 0.75);
  assert.equal(calculateTripTotals([
    { id: "saved", from_label: "A", to_label: "B", kilometers: 100 }
  ], historical?.rate).drivingDeduction, 75);
});

test("trip duplication extracts reusable data without historical accounting facts", () => {
  const original = {
    id: "historical-trip",
    title: "Probe",
    business_reason: "Bandprobe",
    start_point: "Mollis",
    end_point: "Mollis",
    start_at: "2026-08-10T08:00:00Z",
    end_at: "2026-08-10T12:00:00Z",
    applied_mileage_rate: 0.75,
    applied_mileage_currency: "CHF",
    driving_deduction_reporting: 75,
    reimbursement_id: "historical-payment",
    trip_stops: [
      {
        sort_order: 1,
        location: "Zürich",
        country: "Schweiz",
        purpose: "Geschäftlich",
        breakfast_provided: true,
        lunch_provided: false,
        dinner_provided: false
      }
    ],
    trip_segments: [
      {
        sort_order: 1,
        from_label: "Mollis",
        to_label: "Zürich",
        kilometers: 100,
        is_business: true,
        deduction_reporting: 75
      }
    ]
  } as unknown as Trip;

  const preset = createTripTemplatePreset(original);

  assert.deepEqual(preset, {
    title: "Probe",
    business_reason: "Bandprobe",
    start_point: "Mollis",
    end_point: "Mollis",
    stops: [{ location: "Zürich", country: "Schweiz", purpose: "Geschäftlich" }],
    segments: [
      { from_label: "Mollis", to_label: "Zürich", kilometers: 100, is_business: true }
    ]
  });
  assert.equal("start_at" in preset, false);
  assert.equal("applied_mileage_rate" in preset, false);
  assert.equal("driving_deduction_reporting" in preset, false);
  assert.equal("reimbursement_id" in preset, false);
});

test("editing reusable template data cannot mutate the source trip", () => {
  const original = {
    title: "Probe",
    business_reason: "Bandprobe",
    start_point: "A",
    end_point: "A",
    trip_stops: [],
    trip_segments: [
      { sort_order: 1, from_label: "A", to_label: "B", kilometers: 40, is_business: true }
    ]
  } as unknown as Trip;

  const preset = createTripTemplatePreset(original);
  preset.segments[0].kilometers = 55;

  assert.equal(original.trip_segments?.[0].kilometers, 40);
});

test("a same-day German trip must exceed eight hours for a meal allowance", () => {
  const baseDay = {
    date: "2026-05-01",
    countryAtMidnight: "Deutschland",
    breakfastProvided: false,
    lunchProvided: false,
    dinnerProvided: false,
    isArrivalDay: true,
    isDepartureDay: true
  };

  assert.equal(calculatePerDiemForDay({ ...baseDay, absenceHours: 8 }).deductibleAmount, 0);
  assert.equal(calculatePerDiemForDay({ ...baseDay, absenceHours: 8.5 }).deductibleAmount, 14);
});

test("depreciation is included only during its useful-life years", () => {
  assert.equal(isDepreciationActiveInYear("2024-06-15", 3, 2023), false);
  assert.equal(isDepreciationActiveInYear("2024-06-15", 3, 2024), true);
  assert.equal(isDepreciationActiveInYear("2024-06-15", 3, 2026), true);
  assert.equal(isDepreciationActiveInYear("2024-06-15", 3, 2027), false);
});

test("HTML output escapes user-controlled invoice and report values", () => {
  assert.equal(escapeHtml(`<script>alert('x') & \"y\"</script>`), "&lt;script&gt;alert(&#039;x&#039;) &amp; &quot;y&quot;&lt;/script&gt;");
});
