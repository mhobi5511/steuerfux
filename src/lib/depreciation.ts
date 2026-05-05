import { roundMoney } from "@/lib/currency";
import type { BusinessCountry } from "@/lib/db-types";

export function calculateDepreciationSummary(
  acquisitionValueReporting: number,
  usefulLifeYears: number,
  acquisitionYear: number,
  currentYear: number
) {
  const yearlyAmountReporting = roundMoney(acquisitionValueReporting / usefulLifeYears);
  const elapsedYears = Math.max(0, Math.min(currentYear - acquisitionYear + 1, usefulLifeYears));
  const deductedUntilYearReporting = roundMoney(yearlyAmountReporting * elapsedYears);
  const remainingValueReporting = roundMoney(
    Math.max(0, acquisitionValueReporting - deductedUntilYearReporting)
  );
  const remainingYears = Math.max(0, usefulLifeYears - elapsedYears);

  return {
    yearlyAmountReporting,
    deductedUntilYearReporting,
    remainingValueReporting,
    remainingYears
  };
}

export function getDepreciationSuggestion(
  businessCountry: BusinessCountry,
  amountReporting: number,
  category: string
) {
  const normalizedCategory = category.toLowerCase();
  const categoryLooksDurable =
    normalizedCategory.includes("technik") ||
    normalizedCategory.includes("hardware") ||
    normalizedCategory.includes("equipment") ||
    normalizedCategory.includes("instrument") ||
    normalizedCategory.includes("computer") ||
    normalizedCategory.includes("kamera");

  if (businessCountry === "Deutschland") {
    if (amountReporting > 800 || categoryLooksDurable) {
      return {
        likelyDepreciable: true,
        warning: "Bitte prüfen: Diese Ausgabe könnte abschreibungspflichtig sein.",
        defaultUsefulLifeYears: 3
      };
    }
  }

  if (businessCountry === "Schweiz") {
    if (amountReporting > 500 || categoryLooksDurable) {
      return {
        likelyDepreciable: true,
        warning:
          "Bitte prüfen: Diese Ausgabe könnte abschreibungspflichtig sein. Die genaue Schweizer Behandlung kann je nach Fall variieren.",
        defaultUsefulLifeYears: 3
      };
    }
  }

  return {
    likelyDepreciable: false,
    warning: null,
    defaultUsefulLifeYears: 3
  };
}
