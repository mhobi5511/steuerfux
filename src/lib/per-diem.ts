import { roundMoney } from "@/lib/currency";

export type PerDiemRate = {
  country: string;
  arrivalDepartureAmount: number;
  fullDayAmount: number;
};

export type PerDiemDay = {
  date: string;
  countryAtMidnight: string;
  absenceHours: number;
  breakfastProvided: boolean;
  lunchProvided: boolean;
  dinnerProvided: boolean;
  isArrivalDay: boolean;
  isDepartureDay: boolean;
};

export const germanFallbackRate: PerDiemRate = {
  country: "Deutschland",
  arrivalDepartureAmount: 14,
  fullDayAmount: 28
};

export const basePerDiemRates: PerDiemRate[] = [
  germanFallbackRate,
  { country: "Schweiz", arrivalDepartureAmount: 43, fullDayAmount: 64 },
  { country: "England", arrivalDepartureAmount: 44, fullDayAmount: 66 },
  { country: "Portugal", arrivalDepartureAmount: 21, fullDayAmount: 32 },
  { country: "Frankreich", arrivalDepartureAmount: 36, fullDayAmount: 53 }
];

export function findPerDiemRate(country: string) {
  return (
    basePerDiemRates.find((rate) => rate.country.toLowerCase() === country.toLowerCase()) ??
    germanFallbackRate
  );
}

export function calculatePerDiemForDay(day: PerDiemDay) {
  const rate = findPerDiemRate(day.countryAtMidnight);
  const fullDayRate = rate.fullDayAmount;

  let base = 0;
  if (day.isArrivalDay || day.isDepartureDay) {
    base = rate.arrivalDepartureAmount;
  } else if (day.absenceHours >= 24) {
    base = rate.fullDayAmount;
  } else if (day.absenceHours > 8) {
    base = rate.arrivalDepartureAmount;
  }

  const reduction =
    (day.breakfastProvided ? fullDayRate * 0.2 : 0) +
    (day.lunchProvided ? fullDayRate * 0.4 : 0) +
    (day.dinnerProvided ? fullDayRate * 0.4 : 0);

  return {
    country: rate.country,
    baseAmount: roundMoney(base),
    reductionAmount: roundMoney(reduction),
    deductibleAmount: roundMoney(Math.max(0, base - reduction)),
    usedFallback: rate.country === germanFallbackRate.country && day.countryAtMidnight !== "Deutschland"
  };
}
