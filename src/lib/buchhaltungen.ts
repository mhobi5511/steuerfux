import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { AppSettings, Buchhaltung, BusinessCountry, ReportingCurrency } from "@/lib/db-types";
import { getReportingCurrency } from "@/lib/currency";

export const selectedBuchhaltungCookie = "selected_buchhaltung_id";

type Client = SupabaseClient;

export async function listBuchhaltungen(supabase: Client, userId: string) {
  const { data } = await supabase
    .from("buchhaltungen")
    .select("*")
    .eq("user_id", userId)
    .order("status", { ascending: true })
    .order("start_date", { ascending: false });

  return (data ?? []) as Buchhaltung[];
}

export async function ensureDefaultBuchhaltung(
  supabase: Client,
  user: User,
  settings: AppSettings | null
) {
  const existing = await listBuchhaltungen(supabase, user.id);
  if (existing.length > 0) return existing;

  const country = (settings?.business_country ?? "Deutschland") as BusinessCountry;
  const reportingCurrency = (settings?.reporting_currency ??
    getReportingCurrency(country)) as ReportingCurrency;
  const owner = settings?.business_owner_name?.trim();
  const businessYear = settings?.business_year ?? new Date().getFullYear();

  const { data } = await supabase
    .from("buchhaltungen")
    .insert({
      user_id: user.id,
      name: owner ? `Buchhaltung ${owner}` : "Meine Buchhaltung",
      country,
      reporting_currency: reportingCurrency,
      start_date: `${businessYear}-01-01`,
      status: "aktiv"
    })
    .select("*")
    .single();

  return data ? ([data] as Buchhaltung[]) : [];
}

export async function getSelectedBuchhaltung(
  supabase: Client,
  user: User,
  settings: AppSettings | null
) {
  const buchhaltungen = await ensureDefaultBuchhaltung(supabase, user, settings);
  const selectedId = (await cookies()).get(selectedBuchhaltungCookie)?.value;
  const active =
    buchhaltungen.find((item) => item.id === selectedId) ??
    buchhaltungen.find((item) => item.status === "aktiv") ??
    buchhaltungen[0] ??
    null;

  return {
    buchhaltungen,
    activeBuchhaltung: active
  };
}

export function assertWritableBuchhaltung(buchhaltung: Buchhaltung | null): string | null {
  if (!buchhaltung) return "Bitte zuerst eine Buchhaltung anlegen.";
  if (buchhaltung.status === "abgeschlossen") {
    return "Diese Buchhaltung ist abgeschlossen und schreibgeschuetzt.";
  }
  return null;
}

export function applyBuchhaltungSettings<T extends AppSettings | null>(
  settings: T,
  buchhaltung: Buchhaltung | null
) {
  if (!settings || !buchhaltung) return settings;
  return {
    ...settings,
    business_country: buchhaltung.country,
    reporting_currency: buchhaltung.reporting_currency,
    // Input defaults follow the selected book so a global German EUR default
    // can never leak into the Swiss daily-entry workflow (or vice versa).
    default_currency: buchhaltung.reporting_currency,
    business_year: new Date(buchhaltung.start_date).getFullYear()
  };
}
