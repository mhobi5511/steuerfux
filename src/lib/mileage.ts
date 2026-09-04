import type {
  Buchhaltung,
  BusinessCountry,
  MileageYearSetting,
  ReportingCurrency
} from "@/lib/db-types";

export const GERMAN_DEFAULT_MILEAGE_RATE = 0.3;
export const SWISS_2026_DEFAULT_MILEAGE_RATE = 0.75;

export type MileageConfiguration = {
  year: number;
  rate: number;
  currency: ReportingCurrency;
  source: "saved" | "default" | "snapshot";
};

export function getYearFromDate(value: string) {
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : null;
}

export function getDefaultMileageRate(country: BusinessCountry, year: number) {
  if (country === "Deutschland") return GERMAN_DEFAULT_MILEAGE_RATE;
  if (country === "Schweiz" && year === 2026) return SWISS_2026_DEFAULT_MILEAGE_RATE;
  return null;
}

export function getMileageConfiguration({
  buchhaltung,
  year,
  settings
}: {
  buchhaltung: Pick<Buchhaltung, "id" | "country" | "reporting_currency">;
  year: number;
  settings: MileageYearSetting[];
}): MileageConfiguration | null {
  const saved = settings.find(
    (setting) => setting.buchhaltung_id === buchhaltung.id && setting.year === year
  );

  if (saved) {
    if (
      saved.mileage_currency !== buchhaltung.reporting_currency ||
      !Number.isFinite(saved.mileage_rate) ||
      saved.mileage_rate < 0
    ) {
      return null;
    }
    return {
      year,
      rate: saved.mileage_rate,
      currency: saved.mileage_currency,
      source: "saved"
    };
  }

  const defaultRate = getDefaultMileageRate(buchhaltung.country, year);
  return defaultRate === null
    ? null
    : {
        year,
        rate: defaultRate,
        currency: buchhaltung.reporting_currency,
        source: "default"
      };
}

export function preferTripMileageSnapshot({
  configured,
  appliedRate,
  appliedCurrency
}: {
  configured: MileageConfiguration | null;
  appliedRate: number | null | undefined;
  appliedCurrency: ReportingCurrency | null | undefined;
}): MileageConfiguration | null {
  if (
    typeof appliedRate === "number" &&
    Number.isFinite(appliedRate) &&
    appliedRate >= 0 &&
    appliedCurrency
  ) {
    return {
      year: configured?.year ?? 0,
      rate: appliedRate,
      currency: appliedCurrency,
      source: "snapshot"
    };
  }
  return configured;
}
