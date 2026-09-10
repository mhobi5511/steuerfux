import type { InvoiceLegalNotices } from "@/lib/db-types";

/**
 * Presentation-only notice catalogue. Adding another standard notice only
 * requires a new key and entry here; invoice totals never read this module.
 */
export const INVOICE_NOTICE_TEXT = {
  art10_mwstg: "Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG.",
  reverse_charge: "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge) gemäss § 13b UStG."
} as const;

export const EMPTY_INVOICE_LEGAL_NOTICES: InvoiceLegalNotices = {
  art10_mwstg: false,
  reverse_charge: false,
  custom_note: null
};

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeInvoiceLegalNotices(value: unknown): InvoiceLegalNotices {
  const source = readRecord(value);
  const custom = typeof source.custom_note === "string"
    ? source.custom_note.replace(/\r\n?/g, "\n").trim()
    : "";
  return {
    art10_mwstg: source.art10_mwstg === true,
    reverse_charge: source.reverse_charge === true,
    custom_note: custom || null
  };
}

export function validateCustomInvoiceNotice(value: string): string | null {
  if (value.length > 2_000) return "Der freie Hinweis darf höchstens 2.000 Zeichen enthalten.";
  if (/[<>]/.test(value)) return "Der freie Hinweis darf keinen HTML-Code enthalten.";
  return null;
}

/** Ordered output for new invoices. Legacy tax_note values remain untouched. */
export function getConfiguredInvoiceNoticeTexts(value: unknown): string[] {
  const notices = normalizeInvoiceLegalNotices(value);
  return [
    notices.art10_mwstg ? INVOICE_NOTICE_TEXT.art10_mwstg : null,
    notices.reverse_charge ? INVOICE_NOTICE_TEXT.reverse_charge : null,
    notices.custom_note
  ].filter((notice): notice is string => Boolean(notice));
}

export function getInvoiceNoticeTexts({
  legalNotices,
  legacyTaxNote
}: {
  legalNotices: unknown | null;
  legacyTaxNote: string | null;
}): string[] {
  // tax_note is the existing Art. 10 / small-business notice mechanism. It
  // remains visible when its existing checkbox was chosen. The new metadata
  // only adds presentation notes and is deliberately never used for taxes.
  const legacy = legacyTaxNote?.trim() ? [legacyTaxNote.trim()] : [];
  const configured = legalNotices === null ? [] : getConfiguredInvoiceNoticeTexts(legalNotices);
  return [...legacy, ...configured.filter((notice) => !legacy.includes(notice))];
}
