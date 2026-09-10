import assert from "node:assert/strict";
import test from "node:test";
import {
  getConfiguredInvoiceNoticeTexts,
  getInvoiceNoticeTexts,
  normalizeInvoiceLegalNotices,
  validateCustomInvoiceNotice
} from "@/lib/invoice-notices";

const art10 = "Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG.";
const reverseCharge = "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge) gemäss § 13b UStG.";

test("invoice notices are optional, ordered, and presentation-only", () => {
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({}), []);
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({ art10_mwstg: true }), [art10]);
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({ reverse_charge: true }), [reverseCharge]);
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({ art10_mwstg: true, reverse_charge: true }), [art10, reverseCharge]);
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({ custom_note: "Leistung wurde vollständig erbracht." }), ["Leistung wurde vollständig erbracht."]);
  assert.deepEqual(getConfiguredInvoiceNoticeTexts({ art10_mwstg: true, reverse_charge: true, custom_note: "Freier Hinweis" }), [art10, reverseCharge, "Freier Hinweis"]);
});

test("existing and historical Art. 10 tax notes continue using their persisted tax_note", () => {
  assert.deepEqual(
    getInvoiceNoticeTexts({ legalNotices: null, legacyTaxNote: art10 }),
    [art10]
  );
  assert.deepEqual(
    getInvoiceNoticeTexts({ legalNotices: { art10_mwstg: false }, legacyTaxNote: art10 }),
    [art10]
  );
  assert.deepEqual(
    getInvoiceNoticeTexts({ legalNotices: { art10_mwstg: true, reverse_charge: true }, legacyTaxNote: art10 }),
    [art10, reverseCharge]
  );
});

test("custom notices are plain text and normalized for PDF rendering", () => {
  assert.equal(validateCustomInvoiceNotice("<strong>HTML</strong>"), "Der freie Hinweis darf keinen HTML-Code enthalten.");
  assert.equal(validateCustomInvoiceNotice("Nur Text"), null);
  assert.deepEqual(normalizeInvoiceLegalNotices({ custom_note: " Zeile 1\r\nZeile 2 " }), {
    art10_mwstg: false,
    reverse_charge: false,
    custom_note: "Zeile 1\nZeile 2"
  });
});
