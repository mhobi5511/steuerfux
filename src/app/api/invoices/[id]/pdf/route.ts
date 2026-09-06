import { NextResponse } from "next/server";
import { renderInvoicePdf } from "@/components/invoices/invoice-pdf-document";
import {
  createInvoiceAssetDataUrl,
  getInvoiceForView,
  getInvoicePaymentFallback,
  InvoiceAccessError
} from "@/lib/invoice-data";
import {
  createInvoicePdfFilename,
  createPdfContentDisposition,
  hasStoredInvoiceSnapshot,
  resolveInvoiceBankSnapshot
} from "@/lib/invoice-pdf";
import { generatePaymentQr } from "@/lib/payment-qr";

export const runtime = "nodejs";

function value(snapshot: Record<string, unknown> | null | undefined, key: string) {
  return typeof snapshot?.[key] === "string" ? String(snapshot[key]) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Rechnung wurde nicht gefunden." }, { status: 404 });
    }

    const invoice = await getInvoiceForView(id);
    if (!invoice) {
      return NextResponse.json({ error: "Rechnung wurde nicht gefunden." }, { status: 404 });
    }

    const customer = invoice.customer_snapshot as Record<string, unknown>;
    const sender = invoice.sender_snapshot as Record<string, unknown>;
    const snapshotBank = invoice.bank_snapshot as Record<string, unknown> | null;
    const hasBankSnapshot = hasStoredInvoiceSnapshot(snapshotBank);
    // Older invoices without a bank snapshot intentionally retain the existing
    // compatibility fallback, scoped to this invoice's Buchhaltung.
    const paymentFallback = hasBankSnapshot ? null : await getInvoicePaymentFallback(invoice);
    const bank = resolveInvoiceBankSnapshot(
      snapshotBank,
      paymentFallback?.bank as Record<string, unknown> | null | undefined
    );
    const qrSnapshot = (invoice.qr_payment_snapshot ?? {}) as Record<string, unknown>;
    const fallbackQrMode = paymentFallback?.invoiceSettings?.default_use_uploaded_qr
      && value(bank, "qr_storage_path")
      ? "uploaded"
      : paymentFallback?.invoiceSettings?.default_payment_qr_enabled
          && invoice.currency === "EUR"
        ? "generated"
        : "none";
    const qrMode = ["uploaded", "generated", "none"].includes(String(qrSnapshot.mode))
      ? String(qrSnapshot.mode)
      : fallbackQrMode;
    const uploadedQrPath = typeof qrSnapshot.uploaded_qr_storage_path === "string"
      ? qrSnapshot.uploaded_qr_storage_path
      : value(bank, "qr_storage_path");

    let paymentQrImage: string | null = null;
    let paymentQrLabel: string | null = null;
    let qrUnavailable = false;

    try {
      if (qrMode === "uploaded" && uploadedQrPath) {
        paymentQrImage = await createInvoiceAssetDataUrl(
          uploadedQrPath,
          invoice.buchhaltung_id
        );
        paymentQrLabel = "Zahlungs-QR-Code";
        qrUnavailable = !paymentQrImage;
      } else if (qrMode === "generated") {
        const generatedQr = await generatePaymentQr({
          accountHolder: value(bank, "account_holder"),
          iban: value(bank, "iban"),
          bic: value(bank, "bic"),
          amountCents: invoice.gross_total_cents,
          currency: invoice.currency,
          invoiceNumber: invoice.invoice_number,
          purpose: typeof qrSnapshot.payment_purpose === "string"
            ? qrSnapshot.payment_purpose
            : null
        });
        paymentQrImage = generatedQr?.dataUrl ?? null;
        paymentQrLabel = generatedQr?.label ?? null;
        qrUnavailable = !paymentQrImage;
      }
    } catch (error) {
      qrUnavailable = qrMode !== "none";
      console.warn("invoice QR generation error:", error);
    }

    const pdfBuffer = await renderInvoicePdf({
      invoice,
      customer,
      sender,
      bank,
      qrImage: paymentQrImage,
      qrLabel: paymentQrLabel
    });
    const filename = createInvoicePdfFilename(
      invoice.invoice_number,
      value(customer, "company_name")
    );
    const shouldDownload = new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": createPdfContentDisposition(
        filename,
        shouldDownload ? "attachment" : "inline"
      ),
      "Content-Length": String(pdfBuffer.byteLength),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff"
    };
    if (qrUnavailable) headers["X-Invoice-Pdf-Warning"] = "qr-unavailable";

    return new NextResponse(new Uint8Array(pdfBuffer), { headers });
  } catch (error) {
    if (error instanceof InvoiceAccessError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json(
        { error: "Bitte melden Sie sich an, um die Rechnung abzurufen." },
        { status: 401 }
      );
    }
    if (error instanceof InvoiceAccessError && error.code === "LOAD_FAILED") {
      return NextResponse.json(
        { error: "Die Rechnungsdaten konnten nicht geladen werden." },
        { status: 500 }
      );
    }

    console.error("invoice PDF generation error:", error);
    return NextResponse.json(
      { error: "PDF konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
