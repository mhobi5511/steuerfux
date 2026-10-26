"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccountingContext } from "@/lib/data";

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().uuid();

const settingsInputSchema = z.object({
  buchhaltungId: uuid,
  expectedVersion: z.number().int().positive().nullable(),
  taxRateBasisPoints: z.number().int().min(0).max(10_000),
  warningThresholdCents: cents,
  initialBufferCents: cents.nullable(),
  pots: z.array(z.object({
    id: uuid,
    name: z.string().trim().min(1).max(80),
    monthlyTargetCents: cents,
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000)
  })).min(1).max(50)
});

const reconciliationInputSchema = z.object({
  buchhaltungId: uuid,
  idempotencyKey: uuid,
  expectedVersion: z.number().int().positive(),
  expectedBufferCents: cents,
  actualBalanceCents: cents,
  reconciliationType: z.enum(["withdrawal", "refund", "deposit", "transfer", "other"]),
  reason: z.string().trim().min(5).max(500)
});

const confirmationInputSchema = z.object({
  buchhaltungId: uuid,
  idempotencyKey: uuid,
  distributionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  bankBalanceCents: cents,
  expectedBufferCents: cents,
  expectedSettingsVersion: z.number().int().positive(),
  allocations: z.array(z.object({
    potId: uuid,
    allocationCents: cents,
    exceptional: z.boolean()
  })).max(50)
});

export type WealthFirstActionResult = {
  success?: string;
  error?: string;
  recordId?: string;
};

async function getWealthFirstActionContext(buchhaltungId: string) {
  const context = await getAccountingContext();
  const book = context.activeBuchhaltung;
  if (!book || book.id !== buchhaltungId) {
    return { ...context, error: "Die ausgewählte Buchhaltung hat sich geändert. Bitte neu laden." };
  }
  if (book.country !== "Schweiz" || book.reporting_currency !== "CHF") {
    return { ...context, error: "Wealth First ist nur für die Schweizer CHF-Buchhaltung verfügbar." };
  }
  if (book.status !== "aktiv") {
    return { ...context, error: "Die Buchhaltung ist abgeschlossen und schreibgeschützt." };
  }
  return { ...context, error: null };
}

function rpcError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "PGRST202" || error.code === "42P01") {
    return "Die Wealth-First-Migration muss zuerst manuell in Supabase eingespielt werden.";
  }
  return error.message || "Die Aktion konnte nicht abgeschlossen werden.";
}

export async function saveWealthFirstSettings(
  rawInput: z.input<typeof settingsInputSchema>
): Promise<WealthFirstActionResult> {
  const parsed = settingsInputSchema.safeParse(rawInput);
  if (!parsed.success) return { error: "Bitte alle Einstellungen und Spartöpfe prüfen." };
  const input = parsed.data;
  const context = await getWealthFirstActionContext(input.buchhaltungId);
  if (context.error) return { error: context.error };
  const { data, error } = await context.supabase.rpc("save_wealth_first_settings_v1", {
    p_buchhaltung_id: input.buchhaltungId,
    p_expected_version: input.expectedVersion,
    p_tax_rate_basis_points: input.taxRateBasisPoints,
    p_warning_threshold_cents: input.warningThresholdCents,
    p_initial_buffer_cents: input.initialBufferCents,
    p_pots: input.pots.map((pot) => ({
      id: pot.id,
      name: pot.name,
      monthly_target_cents: pot.monthlyTargetCents,
      active: pot.active,
      sort_order: pot.sortOrder
    }))
  });
  if (error) return { error: rpcError(error) ?? undefined };
  revalidatePath("/wealth-first");
  return {
    success: input.expectedVersion === null
      ? "Wealth First wurde eingerichtet. Dein Business-Puffer ist gespeichert."
      : "Die Einstellungen gelten ab der nächsten Verteilung. Die Historie blieb unverändert.",
    recordId: String(data)
  };
}

export async function reconcileWealthFirstBuffer(
  rawInput: z.input<typeof reconciliationInputSchema>
): Promise<WealthFirstActionResult> {
  const parsed = reconciliationInputSchema.safeParse(rawInput);
  if (!parsed.success) return { error: "Bitte Kontostand, Art und Begründung der Abstimmung prüfen." };
  const input = parsed.data;
  const context = await getWealthFirstActionContext(input.buchhaltungId);
  if (context.error) return { error: context.error };
  const { data, error } = await context.supabase.rpc("reconcile_wealth_first_buffer_v1", {
    p_buchhaltung_id: input.buchhaltungId,
    p_idempotency_key: input.idempotencyKey,
    p_expected_version: input.expectedVersion,
    p_expected_buffer_cents: input.expectedBufferCents,
    p_actual_balance_cents: input.actualBalanceCents,
    p_reconciliation_type: input.reconciliationType,
    p_reason: input.reason
  });
  if (error) return { error: rpcError(error) ?? undefined };
  revalidatePath("/wealth-first");
  return {
    success: "Die Abweichung wurde protokolliert und der Business-Puffer ausdrücklich abgestimmt.",
    recordId: String(data)
  };
}

export async function confirmWealthFirstDistribution(
  rawInput: z.input<typeof confirmationInputSchema>
): Promise<WealthFirstActionResult> {
  const parsed = confirmationInputSchema.safeParse(rawInput);
  if (!parsed.success) return { error: "Die Verteilung ist unvollständig oder enthält ungültige Beträge." };
  const input = parsed.data;
  const context = await getWealthFirstActionContext(input.buchhaltungId);
  if (context.error) return { error: context.error };
  const { data, error } = await context.supabase.rpc("confirm_wealth_first_distribution_v1", {
    p_buchhaltung_id: input.buchhaltungId,
    p_idempotency_key: input.idempotencyKey,
    p_distribution_month: `${input.distributionMonth}-01`,
    p_bank_balance_cents: input.bankBalanceCents,
    p_expected_buffer_cents: input.expectedBufferCents,
    p_expected_settings_version: input.expectedSettingsVersion,
    p_allocations: input.allocations.map((allocation) => ({
      pot_id: allocation.potId,
      allocation_cents: allocation.allocationCents,
      exceptional: allocation.exceptional
    }))
  });
  if (error) return { error: rpcError(error) ?? undefined };
  revalidatePath("/wealth-first");
  return {
    success: "Verteilung abgeschlossen. Es wurden keine Banküberweisungen ausgeführt.",
    recordId: String(data)
  };
}
