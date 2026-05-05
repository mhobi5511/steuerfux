import type { BusinessCountry, CurrencyCode, ReportingCurrency } from "@/lib/db-types";

export type ExchangeRateLookupResult = {
  rate: number;
  source: string;
  manualRequired: boolean;
  warning?: string;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundExchangeRate(value: number) {
  return Math.round((value + Number.EPSILON) * 100000) / 100000;
}

export function getReportingCurrency(businessCountry: BusinessCountry): ReportingCurrency {
  return businessCountry === "Schweiz" ? "CHF" : "EUR";
}

export function convertToReportingCurrency(
  amount: number,
  currency: CurrencyCode,
  reportingCurrency: ReportingCurrency,
  chfEurRate: number
) {
  if (currency === reportingCurrency) return roundMoney(amount);
  if (currency === "CHF" && reportingCurrency === "EUR") {
    return roundMoney(amount * chfEurRate);
  }
  if (currency === "EUR" && reportingCurrency === "CHF") {
    return roundMoney(amount / chfEurRate);
  }
  return roundMoney(amount);
}

export function describeExchangeRate(reportingCurrency: ReportingCurrency) {
  return reportingCurrency === "EUR" ? "Wechselkurs CHF -> EUR" : "Wechselkurs CHF -> EUR";
}

export async function fetchHistoricalChfEurRate(date: string): Promise<ExchangeRateLookupResult> {
  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/CHF/EUR?date=${date}&providers=ECB`,
      { next: { revalidate: 60 * 60 * 12 } }
    );

    if (!response.ok) {
      return {
        rate: 0,
        source: "manuell",
        manualRequired: true,
        warning: "Wechselkurs konnte online nicht geladen werden. Bitte manuell eingeben."
      };
    }

    const data = (await response.json()) as { rate?: number };
    if (!data.rate) {
      return {
        rate: 0,
        source: "manuell",
        manualRequired: true,
        warning: "Kein historischer CHF/EUR-Kurs verfügbar. Bitte manuell eingeben."
      };
    }

    return {
      rate: roundExchangeRate(data.rate),
      source: "Frankfurter / ECB",
      manualRequired: false
    };
  } catch {
    return {
      rate: 0,
      source: "manuell",
      manualRequired: true,
      warning: "Die Kursabfrage ist fehlgeschlagen. Die Eingabe kann trotzdem manuell gespeichert werden."
    };
  }
}
