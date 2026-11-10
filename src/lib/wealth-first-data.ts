import { getAccountingContext } from "@/lib/data";
import type {
  WealthFirstDistribution,
  WealthFirstPot,
  WealthFirstReconciliation,
  WealthFirstSurplusSettlement,
  WealthFirstSettings
} from "@/lib/db-types";

export type WealthFirstData = {
  settings: WealthFirstSettings | null;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  reconciliations: WealthFirstReconciliation[];
  surplusSettlements: WealthFirstSurplusSettlement[];
  migrationMissing: boolean;
};

export async function getWealthFirstData(): Promise<WealthFirstData> {
  const { supabase, user, activeBuchhaltung } = await getAccountingContext();
  if (!activeBuchhaltung) {
    return { settings: null, pots: [], distributions: [], reconciliations: [], surplusSettlements: [], migrationMissing: false };
  }

  const scope = { userId: user.id, buchhaltungId: activeBuchhaltung.id };
  const [settingsResult, potsResult, distributionsResult, reconciliationsResult, surplusResult] =
    await Promise.all([
      supabase
        .from("wealth_first_settings")
        .select("*,pending_surplus_cents,tax_transfer_account_key")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .maybeSingle(),
      supabase
        .from("wealth_first_pots")
        .select("*,destination_type,transfer_account_key")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("wealth_first_distributions")
        .select("*,distribution_date,buffer_target_cents_snapshot, allocations:wealth_first_distribution_allocations(*)")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("confirmed_at", { ascending: false })
        .order("id")
        .range(0, 499),
      supabase
        .from("wealth_first_reconciliations")
        .select("*")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("confirmed_at", { ascending: false })
        .limit(50),
      supabase.from("wealth_first_surplus_settlements").select("*")
        .eq("user_id", scope.userId).eq("buchhaltung_id", scope.buchhaltungId)
        .order("created_at", { ascending: false }).limit(50)
    ]);

  const results = [settingsResult, potsResult, distributionsResult, reconciliationsResult, surplusResult];
  const missing = results.some(
    (result) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(result.error?.code ?? "")
  );
  if (missing) {
    return { settings: null, pots: [], distributions: [], reconciliations: [], surplusSettlements: [], migrationMissing: true };
  }
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error("Wealth-First-Daten konnten nicht vollständig geladen werden.");

  // Monthly totals must include every confirmation, including months outside the latest 100.
  const distributions = [...(distributionsResult.data ?? [])];
  let pageSize = distributions.length;
  while (pageSize === 500) {
    const page = await supabase.from("wealth_first_distributions")
      .select("*,distribution_date,buffer_target_cents_snapshot, allocations:wealth_first_distribution_allocations(*)")
      .eq("user_id", scope.userId).eq("buchhaltung_id", scope.buchhaltungId)
      .order("confirmed_at", { ascending: false }).order("id")
      .range(distributions.length, distributions.length + 499);
    if (page.error) throw new Error("Wealth-First-Historie konnte nicht vollständig geladen werden.");
    pageSize = page.data?.length ?? 0;
    distributions.push(...(page.data ?? []));
  }

  return {
    settings: settingsResult.data as WealthFirstSettings | null,
    pots: (potsResult.data ?? []) as WealthFirstPot[],
    distributions: distributions as WealthFirstDistribution[],
    reconciliations: (reconciliationsResult.data ?? []) as WealthFirstReconciliation[],
    surplusSettlements: (surplusResult.data ?? []) as WealthFirstSurplusSettlement[],
    migrationMissing: false
  };
}
