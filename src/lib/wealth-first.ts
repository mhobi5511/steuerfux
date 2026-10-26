export type WealthFirstPotInput = {
  potId: string;
  name: string;
  monthlyTargetCents: number;
  alreadyAllocatedCents: number;
  allocationCents: number;
  exceptional?: boolean;
};

export type WealthFirstCalculationInput = {
  bankBalanceCents: number;
  previousBufferCents: number;
  taxRateBasisPoints: number;
  warningThresholdCents: number;
  pots: WealthFirstPotInput[];
};

export type WealthFirstPotCalculation = WealthFirstPotInput & {
  remainingTargetCents: number;
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
  bufferWarning: boolean;
  reconciles: boolean;
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
  assertCents(input.warningThresholdCents, "Warnschwelle");
  assertCents(input.taxRateBasisPoints, "Steuersatz");
  if (
    input.bankBalanceCents < 0 ||
    input.previousBufferCents < 0 ||
    input.warningThresholdCents < 0 ||
    input.taxRateBasisPoints < 0 ||
    input.taxRateBasisPoints > 10_000
  ) {
    throw new Error("Beträge und Steuersatz müssen innerhalb des gültigen Bereichs liegen.");
  }

  const reconciliationRequired = input.bankBalanceCents < input.previousBufferCents;
  const newReceiptsCents = reconciliationRequired
    ? 0
    : input.bankBalanceCents - input.previousBufferCents;
  const taxReserveCents = reconciliationRequired
    ? 0
    : calculateTaxCents(newReceiptsCents, input.taxRateBasisPoints);
  const availableFundsCents = reconciliationRequired ? 0 : newReceiptsCents - taxReserveCents;
  const pots = input.pots.map((pot) => {
    for (const [value, label] of [
      [pot.monthlyTargetCents, "Monatsziel"],
      [pot.alreadyAllocatedCents, "Bereits zugewiesen"],
      [pot.allocationCents, "Aktuelle Zuweisung"]
    ] as const) {
      assertCents(value, label);
      if (value < 0) throw new Error(`${label} darf nicht negativ sein.`);
    }
    const remainingTargetCents = Math.max(
      0,
      pot.monthlyTargetCents - pot.alreadyAllocatedCents
    );
    return {
      ...pot,
      remainingTargetCents,
      expectedTotalCents: pot.alreadyAllocatedCents + pot.allocationCents,
      exceedsRemainingTarget: pot.allocationCents > remainingTargetCents
    };
  });
  const allocationTotalCents = pots.reduce(
    (sum, pot) => addCents(sum, pot.allocationCents, "Zuweisungssumme"),
    0
  );
  assertCents(allocationTotalCents, "Zuweisungssumme");
  const bufferChangeCents = reconciliationRequired
    ? 0
    : availableFundsCents - allocationTotalCents;
  const resultingBufferCents = reconciliationRequired
    ? input.previousBufferCents
    : addCents(input.previousBufferCents, bufferChangeCents, "Neuer Business-Puffer");
  const shortageCents = Math.max(0, -resultingBufferCents);

  return {
    reconciliationRequired,
    newReceiptsCents,
    taxReserveCents,
    availableFundsCents,
    allocationTotalCents,
    bufferChangeCents,
    resultingBufferCents,
    shortageCents,
    bufferWarning: !reconciliationRequired && resultingBufferCents < input.warningThresholdCents,
    reconciles:
      !reconciliationRequired &&
      input.bankBalanceCents === taxReserveCents + allocationTotalCents + resultingBufferCents,
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
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) {
    return null;
  }
  return Math.round(amount * 100);
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}
