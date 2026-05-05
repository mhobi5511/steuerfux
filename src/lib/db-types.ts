export type CurrencyCode = "EUR" | "CHF";
export type TaxMode = "NETTO" | "BRUTTO";
export type IncomeStatus = "offen" | "bezahlt";
export type BusinessCountry = "Deutschland" | "Schweiz";
export type ReportingCurrency = CurrencyCode;
export type ThemeMode = "hell" | "dunkel" | "system";
export type FeeType =
  | "Bankgebühr"
  | "Wechselkursverlust"
  | "Zahlungsanbieter"
  | "Zahlungsdifferenz aus Einnahme"
  | "Sonstiges";
export type TripPurpose =
  | "Geschäftlich"
  | "Übernachtung geschäftlich"
  | "Privat"
  | "Transit";
export type ReimbursementStatus = "offen" | "abgerechnet" | "bezahlt";
export type ReimbursementContext = "Reise" | "Fahrt" | "Ausgabe" | "Rechnung/Einnahme";

export type BaseRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type CurrencySnapshot = {
  currency: CurrencyCode;
  exchange_rate: number;
  exchange_rate_source: string | null;
  exchange_rate_manual: boolean;
  reporting_currency: ReportingCurrency;
};

export type Income = BaseRow &
  CurrencySnapshot & {
    invoice_date: string;
    payment_date: string | null;
    customer_project: string;
    category: string;
    invoice_amount_original: number;
    payment_received_original: number;
    tax_mode: TaxMode;
    invoice_amount_reporting: number;
    payment_received_reporting: number;
    difference_original: number;
    difference_reporting: number;
    status: IncomeStatus;
    description: string | null;
  };

export type Expense = BaseRow &
  CurrencySnapshot & {
    expense_date: string;
    payment_date: string | null;
    category: string;
    description: string;
    original_amount: number;
    amount_reporting: number;
    deductible: boolean;
    deductible_percentage: number;
    deductible_amount_reporting: number;
    receipt_available: boolean;
    note: string | null;
    is_depreciable: boolean;
    acquisition_value: number | null;
    acquisition_date: string | null;
    useful_life_years: number | null;
    depreciation_method: string | null;
    depreciation_warning: string | null;
    reimbursable_to_client: boolean;
    client_share_percentage: number;
    client_share_mode: "percentage" | "fixed";
    client_share_fixed_amount: number | null;
    client_share_fixed_currency: CurrencyCode | null;
    client_share_fixed_exchange_rate: number | null;
    client_share_fixed_exchange_rate_manual: boolean;
    client_share_amount_original: number;
    client_share_amount_reporting: number;
    effective_amount_reporting: number;
    effective_deductible_amount_reporting: number;
    reimbursement_id: string | null;
  };

export type BankFee = BaseRow &
  CurrencySnapshot & {
    fee_date: string;
    original_amount: number;
    fee_type: FeeType;
    description: string | null;
    amount_reporting: number;
    related_income_id: string | null;
  };

export type PerDiemBreakdownRow = {
  date: string;
  country: string;
  absence_hours: number;
  day_type: string;
  base_amount: number;
  meal_reduction: number;
  deductible_amount: number;
  reason: string;
  private_portion_flag: boolean;
};

export type Depreciation = BaseRow &
  CurrencySnapshot & {
    linked_expense_id: string | null;
    description: string;
    original_amount: number;
    amount_reporting: number;
    acquisition_date: string;
    useful_life_years: number;
    yearly_amount_reporting: number;
    deducted_until_year_reporting: number;
    remaining_value_reporting: number;
    remaining_years: number;
    method: "linear";
    note: string | null;
  };

export type Trip = BaseRow & {
  title: string;
  business_reason: string;
  start_point: string;
  start_at: string;
  end_point: string;
  end_at: string;
  note: string | null;
  total_km: number;
  reporting_currency: ReportingCurrency;
  driving_deduction_reporting: number;
  total_travel_expenses_reporting: number;
  total_per_diem_reporting: number;
  deductible_total_reporting: number;
  mixed_trip_warning: string | null;
  per_diem_breakdown: PerDiemBreakdownRow[];
  reimbursable_to_client: boolean;
  reimbursement_id: string | null;
  trip_stops?: TripStop[];
  trip_segments?: TripSegment[];
};

export type TripStop = BaseRow & {
  trip_id: string;
  sort_order: number;
  location: string;
  country: string;
  arrival_at: string;
  departure_at: string;
  purpose: TripPurpose;
  breakfast_provided: boolean;
  lunch_provided: boolean;
  dinner_provided: boolean;
  note: string | null;
};

export type TripSegment = BaseRow & {
  trip_id: string;
  sort_order: number;
  from_label: string;
  to_label: string;
  kilometers: number;
  is_business: boolean;
  deduction_reporting: number;
  note: string | null;
};

export type ExchangeRate = BaseRow & {
  rate_date: string;
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  rate: number;
  source: string;
};

export type Reimbursement = BaseRow &
  CurrencySnapshot & {
    reimbursement_date: string;
    description: string;
    original_amount: number;
    amount_reporting: number;
    tax_mode: TaxMode;
    context_type: ReimbursementContext;
    linked_record_id: string | null;
    status: ReimbursementStatus;
    note: string | null;
    source_expense_id: string | null;
    source_trip_id: string | null;
  };

export type AppSettings = BaseRow & {
  business_owner_name: string | null;
  business_year: number;
  business_country: BusinessCountry;
  reporting_currency: ReportingCurrency;
  theme_mode: ThemeMode;
  default_home_address: string;
  default_currency: CurrencyCode;
  default_manual_chf_eur_rate: number;
  kleinunternehmer_mode: boolean;
  default_tax_mode: TaxMode;
  estimated_tax_rate: number;
  steuerberater_view: boolean;
};
