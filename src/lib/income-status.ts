import type { IncomeStatus } from "@/lib/db-types";

export function normalizeIncomeStatus(status: string | null | undefined): IncomeStatus {
  if (status === "offen") {
    return "offen";
  }

  return "bezahlt";
}

export function isIncomePaid(status: string | null | undefined) {
  return normalizeIncomeStatus(status) === "bezahlt";
}
