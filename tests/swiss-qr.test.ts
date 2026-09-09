import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import {
  generateSwissQr,
  isSwissBusinessCountry,
  prepareSwissQrWithFallback,
  type SwissQrInput
} from "@/lib/swiss-qr";

const wasmFile = readFileSync(
  new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url)
);
prepareZXingModule({
  overrides: {
    wasmBinary: wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength
    ) as ArrayBuffer
  }
});

const validSwissInvoice: SwissQrInput = {
  creditor: {
    name: "Hobi Creative Arts Schweiz",
    iban: "CH9300762011623852957",
    street: "Musterstrasse",
    houseNumber: "12",
    postalCode: "8001",
    city: "Zürich",
    country: "CH"
  },
  debtor: {
    name: "artGate GmbH",
    street: "Kundenweg",
    houseNumber: "4",
    postalCode: "3000",
    city: "Bern",
    country: "CH"
  },
  amountCents: 200_000,
  currency: "CHF",
  invoiceNumber: "RG-2026-115"
};

test("Swiss CHF invoice generates a sharp printable Swiss QR image", async () => {
  const result = await generateSwissQr(validSwissInvoice);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.kind, "swiss-qr-bill");
  assert.equal(result.referenceType, "none");
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.match(result.svg, /^<svg/);
  const png = Buffer.from(result.dataUrl.split(",")[1], "base64");
  assert.ok(png.byteLength > 5_000);
  // The PDF page supplies the mandatory white quiet zone around the 46 mm symbol.
  const scanImage = await sharp(png)
    .extend({ top: 64, bottom: 64, left: 64, right: 64, background: "white" })
    .png()
    .toBuffer();
  const scanResults = await readBarcodes(scanImage, {
    formats: ["QRCode"],
    tryHarder: true,
    maxNumberOfSymbols: 1
  });
  assert.equal(scanResults.length, 1);
  const decoded = scanResults[0].text;
  assert.match(decoded, /^SPC\r?\n0200\r?\n1\r?\n/);
  assert.match(decoded, /CH9300762011623852957/);
  assert.match(decoded, /2000\.00/);
  assert.match(decoded, /CHF/);
  assert.match(decoded, /RG-2026-115/);
});

test("German business country does not enter the Swiss QR flow", () => {
  assert.equal(isSwissBusinessCountry("Schweiz"), true);
  assert.equal(isSwissBusinessCountry("CH"), true);
  assert.equal(isSwissBusinessCountry("Deutschland"), false);
});

test("missing Swiss creditor address returns a helpful warning", async () => {
  const result = await generateSwissQr({
    ...validSwissInvoice,
    creditor: { ...validSwissInvoice.creditor, city: "" }
  });
  assert.deepEqual(result, {
    ok: false,
    code: "incomplete_creditor_address",
    message: "Swiss QR kann nicht erstellt werden, weil die Unternehmensadresse unvollständig ist."
  });
});

test("missing IBAN returns a helpful warning", async () => {
  const result = await generateSwissQr({
    ...validSwissInvoice,
    creditor: { ...validSwissInvoice.creditor, iban: "" }
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "missing_iban");
});

test("invalid IBAN and missing recipient are rejected before rendering", async () => {
  const invalidIban = await generateSwissQr({
    ...validSwissInvoice,
    creditor: { ...validSwissInvoice.creditor, iban: "CH00INVALID" }
  });
  assert.equal(invalidIban.ok, false);
  if (!invalidIban.ok) assert.equal(invalidIban.code, "invalid_iban");

  const missingRecipient = await generateSwissQr({
    ...validSwissInvoice,
    creditor: { ...validSwissInvoice.creditor, name: "" }
  });
  assert.equal(missingRecipient.ok, false);
  if (!missingRecipient.ok) assert.equal(missingRecipient.code, "missing_recipient");
});

test("QR-IBAN without a proper QR reference is never faked", async () => {
  const result = await generateSwissQr({
    ...validSwissInvoice,
    creditor: {
      ...validSwissInvoice.creditor,
      qrIban: "CH4431999123000889012"
    }
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "qr_reference_required");
});

test("generation failure uses the uploaded fallback image", async () => {
  const result = await prepareSwissQrWithFallback(
    validSwissInvoice,
    async () => "data:image/png;base64,ZmFsbGJhY2s=",
    async () => { throw new Error("renderer unavailable"); }
  );
  assert.equal(result.source, "uploaded-fallback");
  assert.equal(result.dataUrl, "data:image/png;base64,ZmFsbGJhY2s=");
  assert.equal(result.warningCode, "generation_failed");
});

test("generation failure without fallback still allows the invoice PDF to continue", async () => {
  const result = await prepareSwissQrWithFallback(
    validSwissInvoice,
    null,
    async () => ({ ok: false, code: "invalid_payment_data", message: "invalid" })
  );
  assert.equal(result.source, "none");
  assert.equal(result.dataUrl, null);
  assert.equal(result.warningCode, "invalid_payment_data");
});
