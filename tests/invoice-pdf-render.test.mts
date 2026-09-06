import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import type { CurrencyCode, Invoice, InvoiceItem } from "@/lib/db-types";
import { generatePaymentQr } from "@/lib/payment-qr";

type RenderInvoicePdf = (props: {
  invoice: Invoice;
  customer: Record<string, unknown>;
  sender: Record<string, unknown>;
  bank: Record<string, unknown>;
  qrImage: string | null;
  qrLabel: string | null;
}) => Promise<Uint8Array>;

type RenderInvoicePdfWithOptionalQrFallback = (
  props: Parameters<RenderInvoicePdf>[0],
  diagnostics?: {
    onOptionalQrError?: (error: unknown) => void;
  }
) => Promise<{ buffer: Uint8Array; qrOmitted: boolean }>;

const fixtureRoot = path.resolve("tmp/pdfs");
await mkdir(fixtureRoot, { recursive: true });
const bundleDirectory = await mkdtemp(path.join(fixtureRoot, "test-bundle-"));
const bundlePath = path.join(bundleDirectory, "invoice-pdf-document.mjs");
await build({
  entryPoints: ["src/components/invoices/invoice-pdf-document.tsx"],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "react",
  outfile: bundlePath,
  packages: "external",
  platform: "node",
  tsconfig: "tsconfig.json"
});
const {
  renderInvoicePdf,
  renderInvoicePdfWithOptionalQrFallback
} = await import(pathToFileURL(bundlePath).href) as {
  renderInvoicePdf: RenderInvoicePdf;
  renderInvoicePdfWithOptionalQrFallback: RenderInvoicePdfWithOptionalQrFallback;
};

after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

function createInvoice(itemCount: number, currency: CurrencyCode): Invoice {
  const items = Array.from({ length: itemCount }, (_, index): InvoiceItem => ({
    id: `item-${index}`,
    invoice_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    buchhaltung_id: "33333333-3333-4333-8333-333333333333",
    sort_order: index + 1,
    title: `Beratungsleistung ${index + 1}`,
    description: "Ausführliche Leistungsbeschreibung mit einem langen Text, der innerhalb der Tabellenzelle umbrechen muss.",
    quantity: 1,
    unit: "Std.",
    unit_price_cents: 12_500,
    currency,
    vat_rate: currency === "EUR" ? 19 : 0,
    net_amount_cents: 12_500,
    vat_amount_cents: currency === "EUR" ? 2_375 : 0,
    gross_amount_cents: currency === "EUR" ? 14_875 : 12_500,
    created_at: "2026-09-01T10:00:00.000Z"
  }));
  const netTotal = itemCount * 12_500;
  const vatTotal = currency === "EUR" ? itemCount * 2_375 : 0;

  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    buchhaltung_id: "33333333-3333-4333-8333-333333333333",
    customer_id: null,
    bank_account_id: null,
    invoice_number: "RG-2026-114",
    status: "Ausgestellt",
    issue_date: "2026-09-01",
    payment_term: "1 Monat",
    due_date: "2026-10-01",
    currency,
    kleinunternehmer: currency === "CHF",
    customer_snapshot: {},
    sender_snapshot: {},
    bank_snapshot: {},
    qr_payment_snapshot: { mode: "none" },
    vat_exemption_type: currency === "CHF" ? "ch-art-10-mwstg" : null,
    tax_note: currency === "CHF"
      ? "Nicht mehrwertsteuerpflichtig gemäss Art. 10 MWSTG."
      : null,
    notes: null,
    net_total_cents: netTotal,
    vat_total_cents: vatTotal,
    gross_total_cents: netTotal + vatTotal,
    paid_total_cents: 0,
    sent_at: null,
    issued_at: "2026-09-01T10:00:00.000Z",
    income_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    items,
    payments: []
  };
}

const customer = {
  company_name: "Musterfirma Zürich AG",
  street: "Lange Beispielstrasse 42",
  postal_code: "8001",
  city: "Zürich",
  country: "Schweiz",
  email: "rechnung@example.ch"
};
const sender = {
  name: "Beispiel Beratung",
  street: "Hauptstrasse 1",
  postal_code: "8753",
  city: "Mollis",
  country: "Schweiz"
};

test("renderer creates a valid multi-page A4 PDF without a QR code", async () => {
  const pdf = await renderInvoicePdf({
    invoice: createInvoice(45, "CHF"),
    customer,
    sender,
    bank: {
      account_holder: "Beispiel Beratung",
      iban: "CH9300762011623852957",
      bic: "POFICHBEXXX",
      bank_name: "PostFinance"
    },
    qrImage: null,
    qrLabel: null
  });
  const contents = Buffer.from(pdf).toString("latin1");

  assert.equal(Buffer.from(pdf).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(Buffer.byteLength(pdf) > 10_000);
  assert.ok((contents.match(/\/Type \/Page\b/g) ?? []).length >= 2);
  if (process.env.WRITE_INVOICE_PDF_FIXTURES === "1") {
    await writeFile(path.join(fixtureRoot, "invoice-swiss-multipage.pdf"), pdf);
  }
});

test("renderer embeds the generated EPC QR in a German EUR invoice", async () => {
  const qr = await generatePaymentQr({
    accountHolder: "Beispiel Beratung",
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    amountCents: 14_875,
    currency: "EUR",
    invoiceNumber: "RG-2026-114"
  });
  assert.ok(qr);

  const pdf = await renderInvoicePdf({
    invoice: createInvoice(1, "EUR"),
    customer: { ...customer, country: "Deutschland" },
    sender: { ...sender, country: "Deutschland" },
    bank: {
      account_holder: "Beispiel Beratung",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      bank_name: "Beispielbank"
    },
    qrImage: qr.dataUrl,
    qrLabel: qr.label
  });

  assert.equal(Buffer.from(pdf).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(Buffer.byteLength(pdf) > 5_000);
  if (process.env.WRITE_INVOICE_PDF_FIXTURES === "1") {
    await writeFile(path.join(fixtureRoot, "invoice-german-qr.pdf"), pdf);
  }
});

test("a corrupt optional QR image cannot prevent PDF creation", async () => {
  let capturedImageError = false;
  const result = await renderInvoicePdfWithOptionalQrFallback(
    {
      invoice: createInvoice(1, "EUR"),
      customer,
      sender,
      bank: {
        account_holder: "Beispiel Beratung",
        iban: "DE02120300000000202051",
        bic: "BYLADEM1001",
        bank_name: "Beispielbank"
      },
      qrImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      qrLabel: "Defekter Test-QR-Code"
    },
    {
      onOptionalQrError() {
        capturedImageError = true;
      }
    }
  );

  // React-PDF currently handles this truncated PNG internally. If a future
  // decoder version propagates it, our wrapper must take the no-QR fallback.
  assert.equal(result.qrOmitted, capturedImageError);
  assert.equal(Buffer.from(result.buffer).subarray(0, 5).toString("ascii"), "%PDF-");
});
