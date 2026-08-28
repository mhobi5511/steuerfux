import QRCode from "qrcode";
import type { CurrencyCode } from "@/lib/db-types";

export type PaymentQrKind = "epc-sepa" | "generic-ch";

export type PaymentQrInput = {
  accountHolder: string;
  iban: string;
  bic?: string | null;
  bankName?: string | null;
  amountCents: number;
  currency: CurrencyCode;
  invoiceNumber?: string | null;
  purpose?: string | null;
};

export type PaymentQrResult = {
  kind: PaymentQrKind;
  label: string;
  payload: string;
  dataUrl: string;
};

function cleanLine(value: string | null | undefined) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function formatAmount(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function buildPurpose(input: PaymentQrInput) {
  const explicitPurpose = cleanLine(input.purpose);
  if (explicitPurpose) return explicitPurpose;
  return input.invoiceNumber ? `Rechnung ${cleanLine(input.invoiceNumber)}` : "Rechnung";
}

function buildEpcSepaPayload(input: PaymentQrInput) {
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    cleanLine(input.bic),
    cleanLine(input.accountHolder),
    cleanLine(input.iban).replace(/\s+/g, ""),
    `EUR${formatAmount(input.amountCents)}`,
    "",
    "",
    buildPurpose(input)
  ].join("\n");
}

function buildGenericPaymentPayload(input: PaymentQrInput) {
  return [
    "Zahlungsinformationen",
    `Kontoinhaber: ${cleanLine(input.accountHolder)}`,
    `IBAN: ${cleanLine(input.iban).replace(/\s+/g, "")}`,
    cleanLine(input.bic) ? `BIC / SWIFT: ${cleanLine(input.bic)}` : "",
    cleanLine(input.bankName) ? `Bankname: ${cleanLine(input.bankName)}` : "",
    `Betrag: ${formatAmount(input.amountCents)} ${input.currency}`,
    `Verwendungszweck: ${buildPurpose(input)}`
  ].filter(Boolean).join("\n");
}

export function canGeneratePaymentQr(input: PaymentQrInput) {
  return Boolean(cleanLine(input.accountHolder) && cleanLine(input.iban) && input.amountCents > 0);
}

export async function generatePaymentQr(input: PaymentQrInput): Promise<PaymentQrResult | null> {
  if (!canGeneratePaymentQr(input)) return null;

  const isSepa = input.currency === "EUR";
  const payload = isSepa ? buildEpcSepaPayload(input) : buildGenericPaymentPayload(input);
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
    type: "image/png"
  });

  return {
    kind: isSepa ? "epc-sepa" : "generic-ch",
    label: isSepa ? "SEPA-Zahlungs-QR-Code (EPC)" : "Zahlungs-QR-Code mit Zahlungsinformationen",
    payload,
    dataUrl
  };
}
