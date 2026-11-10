export const WEALTH_FIRST_TRANSFER_ACCOUNTS = [
  { key: "glkb_tax", label: "GLKB Steuerkonto" },
  { key: "glkb_service", label: "GLKB Servicekonto" },
  { key: "revolut", label: "Revolut" },
  { key: "yuh", label: "Yuh" }
] as const;

export type WealthFirstTransferAccountKey = (typeof WEALTH_FIRST_TRANSFER_ACCOUNTS)[number]["key"];

export const DEFAULT_TAX_TRANSFER_ACCOUNT: WealthFirstTransferAccountKey = "glkb_tax";

export function isWealthFirstTransferAccountKey(value: string): value is WealthFirstTransferAccountKey {
  return WEALTH_FIRST_TRANSFER_ACCOUNTS.some((account) => account.key === value);
}

export function wealthFirstTransferAccountLabel(key: WealthFirstTransferAccountKey) {
  return WEALTH_FIRST_TRANSFER_ACCOUNTS.find((account) => account.key === key)?.label ?? key;
}

export type WealthFirstTransferItem = {
  accountKey: WealthFirstTransferAccountKey;
  label: string;
  amountCents: number;
};

export type WealthFirstTransferGroup = {
  accountKey: WealthFirstTransferAccountKey;
  label: string;
  amountCents: number;
  items: Array<{ label: string; amountCents: number }>;
};

/** Presentation-only grouping. Zero values and unassigned surplus are deliberately excluded. */
export function groupWealthFirstTransfers(items: WealthFirstTransferItem[]): WealthFirstTransferGroup[] {
  const groups = new Map<WealthFirstTransferAccountKey, WealthFirstTransferGroup>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) continue;
    const group = groups.get(item.accountKey) ?? {
      accountKey: item.accountKey,
      label: wealthFirstTransferAccountLabel(item.accountKey),
      amountCents: 0,
      items: []
    };
    group.amountCents += item.amountCents;
    group.items.push({ label: item.label, amountCents: item.amountCents });
    groups.set(item.accountKey, group);
  }
  return WEALTH_FIRST_TRANSFER_ACCOUNTS
    .map((account) => groups.get(account.key))
    .filter((group): group is WealthFirstTransferGroup => Boolean(group));
}

export function wealthFirstTransferTotal(groups: WealthFirstTransferGroup[]) {
  return groups.reduce((total, group) => total + group.amountCents, 0);
}
