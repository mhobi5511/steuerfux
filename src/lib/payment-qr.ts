import QRCode from "qrcode";
import type { CurrencyCode } from "@/lib/db-types";

export type PaymentQrInput = {
  accountHolder: string;
  iban: string;
  bic?: string | null;
  amountCents: number;
  currency: CurrencyCode;
  invoiceNumber?: string | null;
  purpose?: string | null;
};

export type PaymentQrResult = {
  kind: "epc-sepa";
  label: string;
  payload: string;
  dataUrl: string;
};

const MAX_EPC_PAYLOAD_BYTES = 331;
const MAX_AMOUNT_CENTS = 99_999_999_999;

function cleanLine(value: string | null | undefined) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeIban(value: string | null | undefined) {
  return cleanLine(value).replace(/\s+/g, "").toUpperCase();
}

function isValidIban(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function normalizeBic(value: string | null | undefined) {
  return cleanLine(value).replace(/\s+/g, "").toUpperCase();
}

function isValidBic(bic: string) {
  return !bic || /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?$/.test(bic);
}

function buildPurpose(input: PaymentQrInput) {
  const explicitPurpose = cleanLine(input.purpose);
  return explicitPurpose || (input.invoiceNumber ? `Rechnung ${cleanLine(input.invoiceNumber)}` : "Rechnung");
}

function hasValidEpcData(input: PaymentQrInput) {
  const accountHolder = cleanLine(input.accountHolder);
  const iban = normalizeIban(input.iban);
  const bic = normalizeBic(input.bic);
  const purpose = buildPurpose(input);

  return input.currency === "EUR"
    && Number.isInteger(input.amountCents)
    && input.amountCents >= 1
    && input.amountCents <= MAX_AMOUNT_CENTS
    && accountHolder.length >= 1
    && accountHolder.length <= 70
    && purpose.length >= 1
    && purpose.length <= 140
    && isValidIban(iban)
    && isValidBic(bic);
}

function buildEpcSepaPayload(input: PaymentQrInput) {
  const payload = [
    "BCD",
    "002",
    "1",
    "SCT",
    normalizeBic(input.bic),
    cleanLine(input.accountHolder),
    normalizeIban(input.iban),
    `EUR${(input.amountCents / 100).toFixed(2)}`,
    "",
    "",
    buildPurpose(input)
  ].join("\n");

  return new TextEncoder().encode(payload).length <= MAX_EPC_PAYLOAD_BYTES ? payload : null;
}

export function canGeneratePaymentQr(input: PaymentQrInput) {
  if (!hasValidEpcData(input)) return false;
  return buildEpcSepaPayload(input) !== null;
}

export async function generatePaymentQr(input: PaymentQrInput): Promise<PaymentQrResult | null> {
  const payload = canGeneratePaymentQr(input) ? buildEpcSepaPayload(input) : null;
  if (!payload) return null;

  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
    type: "image/png"
  });

  return {
    kind: "epc-sepa",
    label: "EPC-QR-Code für SEPA-Überweisung",
    payload,
    dataUrl
  };
}
