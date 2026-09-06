const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_FILENAME_LENGTH = 140;

export type InvoiceSnapshot = Record<string, unknown>;

export function hasStoredInvoiceSnapshot(
  snapshot: InvoiceSnapshot | null | undefined
) {
  return Boolean(snapshot && Object.keys(snapshot).length > 0);
}

export function resolveInvoiceBankSnapshot(
  storedSnapshot: InvoiceSnapshot | null | undefined,
  fallback: InvoiceSnapshot | null | undefined
): InvoiceSnapshot {
  return hasStoredInvoiceSnapshot(storedSnapshot) ? storedSnapshot! : fallback ?? {};
}

export function sanitizeInvoiceFilenamePart(value: string, maxLength = 80) {
  return Array.from(
    value
      .normalize("NFC")
      .replace(INVALID_FILENAME_CHARACTERS, " ")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._\s]+|[._\s]+$/g, "")
  )
    .slice(0, maxLength)
    .join("")
    .replace(/[._\s]+$/g, "");
}

export function createInvoicePdfFilename(
  invoiceNumber: string | null | undefined,
  recipientName: string | null | undefined
) {
  const safeNumber = sanitizeInvoiceFilenamePart(invoiceNumber ?? "", 60) || "Entwurf";
  const prefix = `Rechnung_${safeNumber}`;
  const availableRecipientLength = Math.max(
    0,
    MAX_FILENAME_LENGTH - prefix.length - ".pdf".length - 1
  );
  const safeRecipient = sanitizeInvoiceFilenamePart(
    recipientName ?? "",
    availableRecipientLength
  );

  return `${prefix}${safeRecipient ? `_${safeRecipient}` : ""}.pdf`;
}

function toAsciiFilename(filename: string) {
  const ascii = filename
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "SS")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(INVALID_FILENAME_CHARACTERS, "_");

  return ascii || "Rechnung.pdf";
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function createPdfContentDisposition(
  filename: string,
  disposition: "inline" | "attachment"
) {
  return `${disposition}; filename="${toAsciiFilename(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
