import { getAccountingContext } from "@/lib/data";
import type {
  WealthFirstDistribution,
  WealthFirstPot,
  WealthFirstReconciliation,
  WealthFirstSettings
} from "@/lib/db-types";

export type WealthFirstData = {
  settings: WealthFirstSettings | null;
  pots: WealthFirstPot[];
  distributions: WealthFirstDistribution[];
  reconciliations: WealthFirstReconciliation[];
  migrationMissing: boolean;
};

export async function getWealthFirstData(): Promise<WealthFirstData> {
  const { supabase, user, activeBuchhaltung } = await getAccountingContext();
  if (!activeBuchhaltung) {
    return { settings: null, pots: [], distributions: [], reconciliations: [], migrationMissing: false };
  }

  const scope = { userId: user.id, buchhaltungId: activeBuchhaltung.id };
  const [settingsResult, potsResult, distributionsResult, reconciliationsResult] =
    await Promise.all([
      supabase
        .from("wealth_first_settings")
        .select("*")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .maybeSingle(),
      supabase
        .from("wealth_first_pots")
        .select("*")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("wealth_first_distributions")
        .select("*, allocations:wealth_first_distribution_allocations(*)")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("confirmed_at", { ascending: false })
        .limit(100),
      supabase
        .from("wealth_first_reconciliations")
        .select("*")
        .eq("user_id", scope.userId)
        .eq("buchhaltung_id", scope.buchhaltungId)
        .order("confirmed_at", { ascending: false })
        .limit(50)
    ]);

  const results = [settingsResult, potsResult, distributionsResult, reconciliationsResult];
  const missing = results.some(
    (result) => result.error?.code === "42P01" || result.error?.code === "PGRST205"
  );
  if (missing) {
    return { settings: null, pots: [], distributions: [], reconciliations: [], migrationMissing: true };
  }
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error("Wealth-First-Daten konnten nicht vollständig geladen werden.");

  return {
    settings: settingsResult.data as WealthFirstSettings | null,
    pots: (potsResult.data ?? []) as WealthFirstPot[],
    distributions: (distributionsResult.data ?? []) as WealthFirstDistribution[],
    reconciliations: (reconciliationsResult.data ?? []) as WealthFirstReconciliation[],
    migrationMissing: false
  };
}
