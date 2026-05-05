export const appName = "Buchhaltung Marc Hobi";

export const homeAddressDefault = "Ottobrunn, München, Deutschland";

export const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/einnahmen", label: "Einnahmen" },
  { href: "/ausgaben", label: "Ausgaben" },
  { href: "/bank-gebuehren", label: "Bank- & Wechselgebühren" },
  { href: "/fahrten-reisen", label: "Fahrten & Reisen" },
  { href: "/abschreibungen", label: "Abschreibungen" },
  { href: "/export-jahresabschluss", label: "Export & Jahresabschluss" },
  { href: "/einstellungen", label: "Einstellungen" }
] as const;

export const feeTypeOptions = [
  "Bankgebühr",
  "Wechselkursverlust",
  "Zahlungsanbieter",
  "Zahlungsdifferenz aus Einnahme",
  "Sonstiges"
] as const;

export const tripPurposeOptions = [
  "Geschäftlich",
  "Übernachtung geschäftlich",
  "Privat",
  "Transit"
] as const;

export const taxModeOptions = ["NETTO", "BRUTTO"] as const;

export const businessCountryOptions = ["Deutschland", "Schweiz"] as const;
export const reimbursementStatusOptions = ["offen", "abgerechnet", "bezahlt"] as const;
export const reimbursementContextOptions = [
  "Reise",
  "Fahrt",
  "Ausgabe",
  "Rechnung/Einnahme"
] as const;
