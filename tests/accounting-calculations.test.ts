import assert from "node:assert/strict";
import test from "node:test";
import { convertToReportingCurrency } from "@/lib/currency";
import { isDepreciationActiveInYear } from "@/lib/depreciation";
import { calculateDueDate, calculateInvoiceItem } from "@/lib/invoice-utils";
import { calculatePerDiemForDay } from "@/lib/per-diem";
import { calculateTripTotals } from "@/lib/trips";
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
