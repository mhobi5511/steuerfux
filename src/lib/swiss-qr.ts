import sharp from "sharp";
import { SwissQRCode } from "swissqrbill/svg";
import { isIBANValid, isQRIBAN } from "swissqrbill/utils";
import type { CurrencyCode } from "@/lib/db-types";

export type SwissQrAddress = {
  name: string;
  street: string;
  houseNumber?: string | null;
  postalCode: string;
  city: string;
  country: string;
};

export type SwissQrInput = {
  creditor: SwissQrAddress & {
    iban: string;
    qrIban?: string | null;
  };
  debtor?: SwissQrAddress | null;
  amountCents: number;
  currency: CurrencyCode;
  invoiceNumber?: string | null;
  qrReference?: string | null;
};

export type SwissQrFailureCode =
  | "missing_iban"
  | "invalid_iban"
  | "missing_recipient"
  | "invalid_amount"
  | "invalid_currency"
  | "incomplete_creditor_address"
  | "incomplete_debtor_address"
  | "qr_reference_required"
  | "invalid_payment_data"
  | "generation_failed";

export type SwissQrGenerationResult =
  | {
      ok: true;
      kind: "swiss-qr-bill";
      label: string;
      dataUrl: string;
      svg: string;
      referenceType: "none" | "qr-reference";
    }
  | {
      ok: false;
      code: SwissQrFailureCode;
      message: string;
    };

export type SwissQrPreparedResult = {
  dataUrl: string | null;
  label: string | null;
  source: "generated" | "uploaded-fallback" | "none";
  warning: string | null;
  warningCode: SwissQrFailureCode | "fallback_unavailable" | null;
};

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeAccount(value: string | null | undefined) {
  return clean(value).replace(/\s+/g, "").toUpperCase();
}

export function normalizeSwissQrCountry(value: string | null | undefined) {
  const country = clean(value).toLocaleLowerCase("de-CH");
  if (["ch", "schweiz", "switzerland", "suisse", "svizzera"].includes(country)) return "CH";
  if (["li", "liechtenstein"].includes(country)) return "LI";
  if (["de", "deutschland", "germany", "allemagne"].includes(country)) return "DE";
  return country.length === 2 ? country.toUpperCase() : "";
}

export function isSwissBusinessCountry(value: string | null | undefined) {
  return normalizeSwissQrCountry(value) === "CH";
}

function isCompleteAddress(address: SwissQrAddress | null | undefined) {
  return Boolean(
    clean(address?.name)
      && clean(address?.street)
      && clean(address?.postalCode)
      && clean(address?.city)
      && normalizeSwissQrCountry(address?.country)
  );
}

function toLibraryAddress(address: SwissQrAddress) {
  return {
    name: clean(address.name),
    address: clean(address.street),
    ...(clean(address.houseNumber) ? { buildingNumber: clean(address.houseNumber) } : {}),
    zip: clean(address.postalCode),
    city: clean(address.city),
    country: normalizeSwissQrCountry(address.country)
  };
}

export async function generateSwissQr(input: SwissQrInput): Promise<SwissQrGenerationResult> {
  const qrIban = normalizeAccount(input.creditor.qrIban);
  const iban = qrIban || normalizeAccount(input.creditor.iban);

  if (!iban) return { ok: false, code: "missing_iban", message: "Swiss QR kann nicht erstellt werden, weil die IBAN fehlt." };
  if (!isIBANValid(iban) || !/^(CH|LI)/.test(iban) || (qrIban && !isQRIBAN(qrIban))) {
    return { ok: false, code: "invalid_iban", message: "Swiss QR kann nicht erstellt werden, weil die IBAN oder QR-IBAN ungültig ist." };
  }
  if (!clean(input.creditor.name)) return { ok: false, code: "missing_recipient", message: "Swiss QR kann nicht erstellt werden, weil der Zahlungsempfänger fehlt." };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, code: "invalid_amount", message: "Swiss QR kann nicht erstellt werden, weil der Rechnungsbetrag ungültig ist." };
  if (!["CHF", "EUR"].includes(input.currency)) return { ok: false, code: "invalid_currency", message: "Swiss QR unterstützt nur CHF oder EUR." };
  if (!isCompleteAddress(input.creditor)) return { ok: false, code: "incomplete_creditor_address", message: "Swiss QR kann nicht erstellt werden, weil die Unternehmensadresse unvollständig ist." };
  if (input.debtor && !isCompleteAddress(input.debtor)) return { ok: false, code: "incomplete_debtor_address", message: "Swiss QR kann nicht erstellt werden, weil die Empfängeradresse unvollständig ist." };
  if (qrIban && !clean(input.qrReference)) return { ok: false, code: "qr_reference_required", message: "Für eine QR-IBAN ist eine gültige 27-stellige QR-Referenz erforderlich. Es wurde keine Referenz erfunden." };

  try {
    const data = {
      creditor: { ...toLibraryAddress(input.creditor), account: iban },
      ...(input.debtor ? { debtor: toLibraryAddress(input.debtor) } : {}),
      amount: input.amountCents / 100,
      currency: input.currency,
      ...(qrIban
        ? { reference: clean(input.qrReference) }
        : { message: clean(input.invoiceNumber).slice(0, 140) || "Rechnung" })
    } as const;
    const svg = new SwissQRCode(data, 46).toString();
    // Rasterize the 46 mm SVG at print resolution. Rendering at Sharp's
    // default SVG density and scaling afterwards softens module edges enough
    // to make some QR readers unreliable.
    const png = await sharp(Buffer.from(svg), { density: 300 })
      .resize(544, 544)
      .flatten({ background: "#ffffff" })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return {
      ok: true,
      kind: "swiss-qr-bill",
      label: qrIban ? "Swiss QR mit QR-Referenz" : "Swiss QR mit Rechnungsnummer als Mitteilung",
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      svg,
      referenceType: qrIban ? "qr-reference" : "none"
    };
  } catch {
    return { ok: false, code: "invalid_payment_data", message: "Swiss QR konnte mit den hinterlegten Zahlungsdaten nicht erstellt werden." };
  }
}

export async function prepareSwissQrWithFallback(
  input: SwissQrInput,
  loadFallback?: (() => Promise<string | null>) | null,
  generate: (value: SwissQrInput) => Promise<SwissQrGenerationResult> = generateSwissQr
): Promise<SwissQrPreparedResult> {
  let generated: SwissQrGenerationResult;
  try {
    generated = await generate(input);
  } catch {
    generated = { ok: false, code: "generation_failed", message: "Swiss QR konnte wegen eines technischen Fehlers nicht erstellt werden." };
  }

  if (generated.ok) {
    return { dataUrl: generated.dataUrl, label: generated.label, source: "generated", warning: null, warningCode: null };
  }

  if (loadFallback) {
    try {
      const fallback = await loadFallback();
      if (fallback) {
        return { dataUrl: fallback, label: "Swiss Payment QR (Fallback)", source: "uploaded-fallback", warning: generated.message, warningCode: generated.code };
      }
    } catch {
      // PDF generation must continue without a QR image.
    }
  }

  return {
    dataUrl: null,
    label: null,
    source: "none",
    warning: generated.message,
    warningCode: loadFallback ? "fallback_unavailable" : generated.code
  };
}
