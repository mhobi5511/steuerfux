export type CurrencyCode = "EUR" | "CHF";
export type TaxMode = "NETTO" | "BRUTTO";
export type IncomeStatus = "offen" | "bezahlt";
export type BusinessCountry = "Deutschland" | "Schweiz";
export type ReportingCurrency = CurrencyCode;
export type BuchhaltungStatus = "aktiv" | "abgeschlossen";
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
export type InvoiceStatus =
  | "Entwurf"
  | "Ausgestellt"
  | "Versendet"
  | "Teilweise bezahlt"
  | "Bezahlt"
  | "Storniert";
export type ReimbursementContext = "Reise" | "Fahrt" | "Ausgabe" | "Rechnung/Einnahme";

export type BaseRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type Buchhaltung = BaseRow & {
  name: string;
  country: BusinessCountry;
  reporting_currency: ReportingCurrency;
  start_date: string;
  end_date: string | null;
  status: BuchhaltungStatus;
};

export type Receipt = {
  id: string;
  user_id: string;
  buchhaltung_id: string;
  expense_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export type Customer = BaseRow & {
  buchhaltung_id: string;
  company_name: string;
  contact_name: string | null;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string | null;
  customer_number: string | null;
  notes: string | null;
};

export type BankAccount = BaseRow & {
  buchhaltung_id: string;
  label: string;
  currency: CurrencyCode;
  account_holder: string;
  iban: string;
  bic: string;
  bank_name: string;
  bank_address: string | null;
  qr_storage_path: string | null;
  is_default: boolean;
};

export type InvoiceSettings = BaseRow & {
  buchhaltung_id: string;
  sender_name: string | null;
  sender_addition: string | null;
  sender_street: string | null;
  sender_postal_code: string | null;
  sender_city: string | null;
  sender_country: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  sender_tax_id: string | null;
  logo_storage_path: string | null;
  invoice_prefix: string;
  next_invoice_number: number;
  yearly_reset: boolean;
  default_payment_term: string;
  default_kleinunternehmer: boolean;
  default_payment_qr_enabled: boolean;
  default_use_uploaded_qr: boolean;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  user_id: string;
  buchhaltung_id: string;
  sort_order: number;
  title: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price_cents: number;
  currency: CurrencyCode;
  vat_rate: number;
  net_amount_cents: number;
  vat_amount_cents: number;
  gross_amount_cents: number;
  created_at: string;
};

export type InvoicePayment = {
  id: string;
  invoice_id: string;
  income_id: string | null;
  user_id: string;
  buchhaltung_id: string;
  payment_date: string;
  amount_cents: number;
  currency: CurrencyCode;
  fee_cents: number;
  note: string | null;
  created_at: string;
};

export type Invoice = BaseRow & {
  buchhaltung_id: string;
  customer_id: string | null;
  bank_account_id: string | null;
  invoice_number: string | null;
  status: InvoiceStatus;
  issue_date: string;
  payment_term: string;
  due_date: string;
  currency: CurrencyCode;
  kleinunternehmer: boolean;
  customer_snapshot: Record<string, unknown>;
  sender_snapshot: Record<string, unknown>;
  bank_snapshot: Record<string, unknown> | null;
  qr_payment_snapshot: Record<string, unknown>;
  vat_exemption_type: "de-19-ustg" | "ch-art-10-mwstg" | null;
  tax_note: string | null;
  notes: string | null;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  paid_total_cents: number;
  sent_at: string | null;
  issued_at: string | null;
  income_id: string | null;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
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
    buchhaltung_id: string;
    invoice_id: string | null;
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
    buchhaltung_id: string;
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
    receipts?: Receipt[];
  };

export type BankFee = BaseRow &
  CurrencySnapshot & {
    buchhaltung_id: string;
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
    buchhaltung_id: string;
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
  buchhaltung_id: string;
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
  buchhaltung_id: string;
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
  buchhaltung_id: string;
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
    buchhaltung_id: string;
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
