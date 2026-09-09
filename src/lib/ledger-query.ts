import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoicePayment } from "@/lib/db-types";

/** Financial totals must not silently stop at Supabase's default response limit. */
export async function readLedgerPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) throw new Error("Buchhaltungsdaten konnten nicht vollständig geladen werden.");
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

export async function readScopedPayments(supabase: SupabaseClient, userId: string, buchhaltungId: string) {
  return readLedgerPages<InvoicePayment>((from, to) => supabase.from("invoice_payments").select("*")
    .eq("user_id", userId).eq("buchhaltung_id", buchhaltungId).order("id").range(from, to));
}
