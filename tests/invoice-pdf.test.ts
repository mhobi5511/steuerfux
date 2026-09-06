import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvoicePdfFilename,
  createPdfContentDisposition,
  resolveInvoiceBankSnapshot
} from "@/lib/invoice-pdf";

test("invoice PDF filenames keep safe umlauts and exclude invalid characters", () => {
  assert.equal(
    createInvoicePdfFilename("RG-2026/114", "Müller: Musik GmbH"),
    "Rechnung_RG-2026_114_Müller_Musik_GmbH.pdf"
  );
  assert.equal(
    createInvoicePdfFilename("RG-2026-114", ""),
    "Rechnung_RG-2026-114.pdf"
  );
  assert.ok(createInvoicePdfFilename("RG-1", "Ä".repeat(300)).length <= 140);
});

test("content disposition supports UTF-8 and an ASCII fallback", () => {
  const disposition = createPdfContentDisposition(
    "Rechnung_RG-1_Müller.pdf",
    "attachment"
  );
  assert.match(disposition, /^attachment;/);
  assert.match(disposition, /filename="Rechnung_RG-1_Muller\.pdf"/);
  assert.match(disposition, /filename\*=UTF-8''Rechnung_RG-1_M%C3%BCller\.pdf/);
});

test("a partial historical bank snapshot wins over current fallback settings", () => {
  const historical = { account_holder: "Historische Firma" };
  const current = { account_holder: "Aktuelle Firma", iban: "DE02120300000000202051" };
  assert.equal(resolveInvoiceBankSnapshot(historical, current), historical);
  assert.equal(resolveInvoiceBankSnapshot({}, current), current);
});
