export const WEALTH_FIRST_DEFAULT_TARGETS = [
  { name: "Servicekonto", monthlyTargetCents: 4_000, destinationType: "service_account", transferAccountKey: "glkb_service" },
  { name: "Kautionsfonds", monthlyTargetCents: 62_000, destinationType: "private_pot", transferAccountKey: "yuh" },
  { name: "Guilt Free", monthlyTargetCents: 45_000, destinationType: "private_pot", transferAccountKey: "revolut" },
  { name: "ETF-Investitionen", monthlyTargetCents: 75_000, destinationType: "private_pot", transferAccountKey: "yuh" },
  { name: "Privater Notgroschen", monthlyTargetCents: 42_500, destinationType: "private_pot", transferAccountKey: "yuh" }
] as const;

export type WealthFirstPotInput = {
  potId: string;
  name: string;
  monthlyTargetCents: number;
  alreadyAllocatedCents: number;
  allocationCents?: number;
  destinationType?: "service_account" | "private_pot";
  sortOrder?: number;
  exceptional?: boolean;
};

export type WealthFirstCalculationInput = {
  bankBalanceCents: number;
  previousBufferCents: number;
  taxRateBasisPoints: number;
  bufferTargetCents: number;
  previousPendingSurplusCents?: number;
  surplusTransferConfirmed?: boolean;
  excessBufferReleaseConfirmed?: boolean;
  pots: WealthFirstPotInput[];
};

export type WealthFirstPotCalculation = WealthFirstPotInput & {
  allocationCents: number;
  remainingTargetCents: number;
  remainingAfterCents: number;
  proposedAllocationCents: number;
  expectedTotalCents: number;
  exceedsRemainingTarget: boolean;
};

export type WealthFirstCalculation = {
  reconciliationRequired: boolean;
  newReceiptsCents: number;
  taxReserveCents: number;
  availableFundsCents: number;
  allocationTotalCents: number;
  bufferChangeCents: number;
  resultingBufferCents: number;
  shortageCents: number;
  bufferBelowTarget: boolean;
  bufferShortfallCents: number;
  previousBufferExcessCents: number;
  excessBufferReleaseRequired: boolean;
  remainingAfterAllocationsCents: number;
  investmentSurplusCents: number;
  totalSurplusCents: number;
  surplusTransferCents: number;
  pendingSurplusCents: number;
  expectedBankBalanceCents: number;
  reconciles: boolean;
  validationErrors: string[];
  pots: WealthFirstPotCalculation[];
};

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} muss in ganzen Rappen vorliegen.`);
}

function addCents(left: number, right: number, label: string) {
  const result = left + right;
  assertCents(result, label);
  return result;
}

function calculateTaxCents(receiptsCents: number, taxRateBasisPoints: number) {
  // All values are non-negative. Adding half the denominator implements the
  // same commercial rounding as PostgreSQL numeric round(), without floats.
  return Number(
    (BigInt(receiptsCents) * BigInt(taxRateBasisPoints) + 5_000n) / 10_000n
  );
}

export function calculateWealthFirstDistribution(
  input: WealthFirstCalculationInput
): WealthFirstCalculation {
  assertCents(input.bankBalanceCents, "Kontostand");
  assertCents(input.previousBufferCents, "Business-Puffer");
  assertCents(input.bufferTargetCents, "Business-Puffer-Ziel");
  const previousPending = input.previousPendingSurplusCents ?? 0;
  assertCents(previousPending, "Offener Überschuss");
  assertCents(input.taxRateBasisPoints, "Steuersatz");
  if (
    input.bankBalanceCents < 0 ||
    input.previousBufferCents < 0 ||
    input.bufferTargetCents < 0 || previousPending < 0 ||
    input.taxRateBasisPoints < 0 ||
    input.taxRateBasisPoints > 10_000
  ) {
    throw new Error("Beträge und Steuersatz müssen innerhalb des gültigen Bereichs liegen.");
  }

  const previousRetained = addCents(input.previousBufferCents, previousPending, "Reservierter Kontostand");
  const reconciliationRequired = input.bankBalanceCents < previousRetained;
  const newReceiptsCents = reconciliationRequired
    ? 0
    : input.bankBalanceCents - previousRetained;
  const taxReserveCents = reconciliationRequired
    ? 0
    : calculateTaxCents(newReceiptsCents, input.taxRateBasisPoints);
  const availableFundsCents = reconciliationRequired ? 0 : newReceiptsCents - taxReserveCents;
  const validationErrors: string[] = [];
  let shortageCents = 0;
  // Pending surplus is earmarked separately and cannot be taxed or allocated again.
  let remainingMoney = reconciliationRequired ? 0 : input.bankBalanceCents - previousPending - taxReserveCents;
  const orderedPots = [...input.pots].sort((a, b) =>
    Number(b.destinationType === "service_account") - Number(a.destinationType === "service_account") ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.potId.localeCompare(b.potId));
  const pots = orderedPots.map((pot) => {
    for (const [value, label] of [
      [pot.monthlyTargetCents, "Monatsziel"],
      [pot.alreadyAllocatedCents, "Bereits zugewiesen"],
      [pot.allocationCents ?? 0, "Aktuelle Zuweisung"]
    ] as const) {
      assertCents(value, label);
      if (value < 0) throw new Error(`${label} darf nicht negativ sein.`);
    }
    const remainingTargetCents = Math.max(
      0,
      pot.monthlyTargetCents - pot.alreadyAllocatedCents
    );
    const proposedAllocationCents = Math.min(remainingTargetCents, remainingMoney);
    const requested = pot.allocationCents ?? proposedAllocationCents;
    if (requested > proposedAllocationCents && !pot.exceptional) {
      validationErrors.push(`${pot.name}: Die Zuweisung darf höchstens ${formatChfCents(proposedAllocationCents)} betragen. Bitte reduzieren oder die automatische Verteilung verwenden.`);
    }
    if (requested > remainingMoney) {
      shortageCents = addCents(shortageCents, requested - remainingMoney, "Fehlbetrag");
      validationErrors.push(`${pot.name}: Die Zuweisung übersteigt die verfügbaren Mittel.`);
    }
    // Invalid manual input blocks confirmation, but never produces a negative preview buffer.
    const allocationCents = Math.min(requested, remainingMoney);
    remainingMoney -= allocationCents;
    return {
      ...pot,
      allocationCents,
      proposedAllocationCents,
      remainingTargetCents,
      remainingAfterCents: Math.max(0, remainingTargetCents - allocationCents),
      expectedTotalCents: addCents(pot.alreadyAllocatedCents, allocationCents, "Monatssumme"),
      exceedsRemainingTarget: requested > remainingTargetCents
    };
  });
  const allocationTotalCents = pots.reduce(
    (sum, pot) => addCents(sum, pot.allocationCents, "Zuweisungssumme"),
    0
  );
  assertCents(allocationTotalCents, "Zuweisungssumme");
  const resultingBufferCents = reconciliationRequired
    ? input.previousBufferCents
    : Math.min(remainingMoney, input.bufferTargetCents);
  const investmentSurplusCents = reconciliationRequired ? 0 : remainingMoney - resultingBufferCents;
  const totalSurplusCents = addCents(previousPending, investmentSurplusCents, "Verfügbarer Überschuss");
  const surplusTransferCents = !reconciliationRequired && input.surplusTransferConfirmed ? totalSurplusCents : 0;
  const pendingSurplusCents = totalSurplusCents - surplusTransferCents;
  const bufferChangeCents = resultingBufferCents - input.previousBufferCents;
  const bufferShortfallCents = Math.max(0, input.bufferTargetCents - resultingBufferCents);
  const previousBufferExcessCents = Math.max(0, input.previousBufferCents - input.bufferTargetCents);
  const excessBufferReleaseRequired = previousBufferExcessCents > 0 && investmentSurplusCents > 0;
  if (excessBufferReleaseRequired && !input.excessBufferReleaseConfirmed) {
    validationErrors.push("Der bisherige Business-Puffer liegt über dem Ziel. Bitte die Freigabe des bisherigen Überhangs ausdrücklich bestätigen. Ohne Freigabe wird nichts gespeichert.");
  }

  return {
    reconciliationRequired,
    newReceiptsCents,
    taxReserveCents,
    availableFundsCents,
    allocationTotalCents,
    bufferChangeCents,
    resultingBufferCents,
    shortageCents,
    validationErrors,
    bufferBelowTarget: !reconciliationRequired && bufferShortfallCents > 0,
    bufferShortfallCents,
    previousBufferExcessCents,
    excessBufferReleaseRequired,
    remainingAfterAllocationsCents: remainingMoney,
    investmentSurplusCents,
    totalSurplusCents,
    surplusTransferCents,
    pendingSurplusCents,
    expectedBankBalanceCents: addCents(resultingBufferCents, pendingSurplusCents, "Erwarteter Bankstand"),
    reconciles:
      !reconciliationRequired &&
      input.bankBalanceCents === taxReserveCents + allocationTotalCents + surplusTransferCents + resultingBufferCents + pendingSurplusCents,
    pots
  };
}

export function parseChfToCents(value: string): number | null {
  const compact = value.trim().replace(/[\s']/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function isDistributionDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function distributionDateForMonth(month: string, day: "10" | "25") {
  const value = `${month}-${day}`;
  return isDistributionDate(value) ? value : "";
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export function formatChfCents(cents: number) {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export function currentZurichMonth(date = new Date()) {
  return currentZurichDate(date).slice(0, 7);
}

export function currentZurichDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
