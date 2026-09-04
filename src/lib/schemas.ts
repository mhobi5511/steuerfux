import { z } from "zod";

const currencySchema = z.enum(["EUR", "CHF"]);
const taxModeSchema = z.enum(["NETTO", "BRUTTO"]);

export const incomeSchema = z.object({
  invoice_date: z.string().min(1, "Rechnungsdatum fehlt."),
  payment_date: z.string().optional().nullable(),
  customer_project: z.string().min(2, "Kunde / Projekt fehlt."),
  category: z.string().optional().nullable(),
  invoice_amount_original: z.coerce.number().nonnegative(),
  payment_received_original: z.coerce.number().optional().nullable(),
  currency: currencySchema,
  tax_mode: taxModeSchema.default("BRUTTO"),
  exchange_rate: z.coerce.number().positive().default(1),
  exchange_rate_manual: z.boolean().default(false),
  status: z.enum(["offen", "bezahlt"]).optional().nullable(),
  description: z.string().optional().nullable()
});

export const expenseSchema = z.object({
  payment_date: z.string().min(1, "Zahlungsdatum fehlt."),
  category: z.string().optional().nullable(),
  description: z.string().min(2, "Beschreibung fehlt."),
  original_amount: z.coerce.number().nonnegative(),
  currency: currencySchema,
  tax_mode: taxModeSchema.default("BRUTTO"),
  exchange_rate: z.coerce.number().positive().default(1),
  exchange_rate_manual: z.boolean().default(false),
  deductible: z.boolean().default(true),
  deductible_percentage: z.coerce.number().min(0).max(100).default(100),
  receipt_available: z.boolean().default(false),
  note: z.string().optional().nullable(),
  is_depreciable: z.boolean().default(false),
  acquisition_value: z.coerce.number().optional().nullable(),
  acquisition_date: z.string().optional().nullable(),
  useful_life_years: z.coerce.number().optional().nullable(),
  depreciation_method: z.string().optional().nullable(),
  reimbursable_to_client: z.boolean().default(false),
  client_share_percentage: z.coerce.number().min(0).max(100).default(0),
  client_share_mode: z.enum(["percentage", "fixed"]).default("fixed"),
  client_share_fixed_amount: z.coerce.number().min(0).optional().nullable(),
  client_share_fixed_currency: currencySchema.optional().nullable(),
  client_share_fixed_exchange_rate: z.coerce.number().positive().optional().nullable(),
  client_share_fixed_exchange_rate_manual: z.boolean().default(false)
});

export const bankFeeSchema = z.object({
  fee_date: z.string().min(1, "Datum der Gebühr fehlt."),
  original_amount: z.coerce.number().nonnegative(),
  currency: currencySchema,
  fee_type: z.enum([
    "Bankgebühr",
    "Wechselkursverlust",
    "Zahlungsanbieter",
    "Zahlungsdifferenz aus Einnahme",
    "Sonstiges"
  ]),
  description: z.string().optional().nullable(),
  exchange_rate: z.coerce.number().positive(),
  exchange_rate_manual: z.boolean().default(false),
  related_income_id: z.string().uuid().optional().nullable()
});

export const depreciationSchema = z.object({
  description: z.string().min(2, "Beschreibung fehlt."),
  original_amount: z.coerce.number().nonnegative(),
  currency: currencySchema,
  exchange_rate: z.coerce.number().positive(),
  exchange_rate_manual: z.boolean().default(false),
  acquisition_date: z.string().min(1, "Anschaffungsdatum fehlt."),
  useful_life_years: z.coerce.number().min(1),
  note: z.string().optional().nullable(),
  linked_expense_id: z.string().uuid().optional().nullable()
});

export const reimbursementSchema = z.object({
  reimbursement_date: z.string().min(1, "Datum fehlt."),
  description: z.string().min(2, "Beschreibung fehlt."),
  original_amount: z.coerce.number().nonnegative(),
  currency: currencySchema,
  tax_mode: taxModeSchema,
  exchange_rate: z.coerce.number().positive(),
  exchange_rate_manual: z.boolean().default(false),
  context_type: z.enum(["Reise", "Fahrt", "Ausgabe", "Rechnung/Einnahme"]),
  linked_record_id: z.string().uuid().optional().nullable(),
  status: z.enum(["offen", "abgerechnet", "bezahlt"]),
  note: z.string().optional().nullable(),
  source_expense_id: z.string().uuid().optional().nullable(),
  source_trip_id: z.string().uuid().optional().nullable()
});

export const settingsSchema = z.object({
  business_owner_name: z.string().optional().nullable(),
  business_year: z.coerce.number().min(2020).max(2100),
  business_country: z.enum(["Deutschland", "Schweiz"]),
  reporting_currency: currencySchema,
  theme_mode: z.enum(["hell", "dunkel", "system"]).default("system"),
  default_home_address: z.string().min(5),
  default_currency: currencySchema,
  default_manual_chf_eur_rate: z.coerce.number().positive(),
  kleinunternehmer_mode: z.boolean().default(true),
  default_tax_mode: taxModeSchema,
  steuerberater_view: z.boolean().default(false)
});

export const mileageYearSettingsSchema = z.object({
  year: z.coerce
    .number()
    .int("Das Abrechnungsjahr muss eine ganze Zahl sein.")
    .min(2020, "Das Abrechnungsjahr muss zwischen 2020 und 2100 liegen.")
    .max(2100, "Das Abrechnungsjahr muss zwischen 2020 und 2100 liegen."),
  mileage_rate: z.coerce.number().nonnegative("Der Kilometersatz darf nicht negativ sein."),
  mileage_currency: currencySchema
});

export const tripTemplatePresetSchema = z.object({
  title: z.string().trim().min(1, "Eine Reisebezeichnung fehlt.").max(200),
  business_reason: z.string().trim().max(300),
  start_point: z.string().trim().min(1, "Der Startpunkt fehlt.").max(300),
  end_point: z.string().trim().min(1, "Der Endpunkt fehlt.").max(300),
  stops: z
    .array(
      z.object({
        location: z.string().trim().min(1).max(300),
        country: z.string().trim().min(1).max(100),
        purpose: z.enum(["Geschäftlich", "Übernachtung geschäftlich", "Privat", "Transit"])
      })
    )
    .max(30),
  segments: z
    .array(
      z.object({
        from_label: z.string().trim().min(1).max(300),
        to_label: z.string().trim().min(1).max(300),
        kilometers: z.number().finite().nonnegative(),
        is_business: z.boolean()
      })
    )
    .min(1)
    .max(31)
});
