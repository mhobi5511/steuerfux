import type { BusinessCountry } from "@/lib/db-types";

export type VatExemptionType = "de-19-ustg" | "ch-art-10-mwstg";

export function getVatExemptionType(country: BusinessCountry): VatExemptionType {
  return country === "Schweiz" ? "ch-art-10-mwstg" : "de-19-ustg";
}

export function getVatExemptionLabel(country: BusinessCountry) {
  return country === "Schweiz"
    ? "Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG"
    : "Kleinunternehmerregelung §19 UStG anwenden";
}

export function getVatExemptionSettingsLabel(country: BusinessCountry) {
  return country === "Schweiz"
    ? "Art. 10 MWSTG als Standard"
    : "§19 UStG als Standard";
}

export function getVatExemptionSentence(country: BusinessCountry) {
  return country === "Schweiz"
    ? "Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG."
    : "Nach der Kleinunternehmerregelung laut §19 UStG entfällt die Verrechnung der Umsatzsteuer.";
}
